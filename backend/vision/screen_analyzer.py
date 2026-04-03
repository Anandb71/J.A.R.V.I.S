from __future__ import annotations

from dataclasses import dataclass
import ctypes
import sys
from typing import Any

from backend.vision.privacy import PrivacyFilter


if sys.platform == "win32":
    sys.coinit_flags = 2

user32 = ctypes.windll.user32


@dataclass(frozen=True)
class ControlNode:
    name: str
    control_type: str
    class_name: str | None = None
    automation_id: str | None = None
    rectangle: tuple[int, int, int, int] | None = None
    children: list["ControlNode"] | None = None


@dataclass(frozen=True)
class WindowSnapshot:
    provider: str
    hwnd: int | None
    title: str
    class_name: str | None
    process_id: int | None
    root: ControlNode | None
    warnings: list[str]


class ScreenAnalyzer:
    """Extracts a structured UI tree from the foreground window."""

    def __init__(self, privacy_mode: bool = True) -> None:
        self.privacy = PrivacyFilter(enabled=privacy_mode)
        self.provider = "uia"

    def get_foreground_hwnd(self) -> int | None:
        try:
            hwnd = user32.GetForegroundWindow()
            return int(hwnd) if hwnd else None
        except Exception:
            return None

    def capture_active_window(self, max_depth: int = 3, max_nodes: int = 64) -> WindowSnapshot:
        hwnd = self.get_foreground_hwnd()
        if not hwnd:
            return WindowSnapshot(
                provider=self.provider,
                hwnd=None,
                title="",
                class_name=None,
                process_id=None,
                root=None,
                warnings=["No foreground window detected"],
            )

        try:
            from pywinauto import Desktop  # type: ignore
        except Exception as exc:
            return WindowSnapshot(
                provider="unavailable",
                hwnd=hwnd,
                title="",
                class_name=None,
                process_id=None,
                root=None,
                warnings=[f"pywinauto unavailable: {exc}"],
            )

        warnings: list[str] = []
        try:
            desktop = Desktop(backend="uia")
            window = desktop.window(handle=hwnd).wrapper_object()
        except Exception as exc:
            return WindowSnapshot(
                provider="uia",
                hwnd=hwnd,
                title="",
                class_name=None,
                process_id=None,
                root=None,
                warnings=[f"Unable to access foreground window: {exc}"],
            )

        title = self.privacy.redact(self._safe_call(window, "window_text"))
        class_name = self._safe_call(window, "class_name")
        process_id = self._safe_attr(window, "process_id")

        root = self._build_tree(window, depth=0, max_depth=max_depth, remaining=[max_nodes], warnings=warnings)
        return WindowSnapshot(
            provider="uia",
            hwnd=hwnd,
            title=title,
            class_name=class_name,
            process_id=process_id,
            root=root,
            warnings=warnings,
        )

    def summarize(self, snapshot: WindowSnapshot) -> dict[str, Any]:
        return {
            "provider": snapshot.provider,
            "hwnd": snapshot.hwnd,
            "window_title": snapshot.title,
            "class_name": snapshot.class_name,
            "process_id": snapshot.process_id,
            "privacy_mode": self.privacy.enabled,
            "warnings": snapshot.warnings,
            "root": self._node_to_dict(snapshot.root) if snapshot.root else None,
        }

    def get_status(self) -> dict[str, object]:
        return {
            "provider": self.provider,
            "privacy_mode": self.privacy.enabled,
            "foreground_hwnd": self.get_foreground_hwnd(),
        }

    def _build_tree(
        self,
        element: Any,
        depth: int,
        max_depth: int,
        remaining: list[int],
        warnings: list[str],
    ) -> ControlNode:
        name = self.privacy.redact(self._safe_call(element, "window_text")) or ""
        control_type = self._safe_call(element, "friendly_class_name") or self._safe_call(element, "element_info.control_type") or "Control"
        class_name = self._safe_call(element, "class_name")
        automation_id = self._safe_attr(element, "automation_id")
        rect = self._safe_rect(element)

        children: list[ControlNode] = []
        if depth < max_depth and remaining[0] > 0:
            try:
                child_elements = element.children()
            except Exception as exc:
                warnings.append(f"Unable to enumerate children: {exc}")
                child_elements = []

            for child in child_elements:
                if remaining[0] <= 0:
                    break
                remaining[0] -= 1
                children.append(self._build_tree(child, depth + 1, max_depth, remaining, warnings))

        return ControlNode(
            name=name,
            control_type=control_type,
            class_name=class_name,
            automation_id=automation_id,
            rectangle=rect,
            children=children,
        )

    def _safe_call(self, element: Any, method: str) -> str:
        try:
            if "." in method:
                head, tail = method.split(".", 1)
                target = getattr(element, head, None)
                if target is None:
                    return ""
                value = getattr(target, tail, None)
                return str(value() if callable(value) else value or "")
            value = getattr(element, method)
            return str(value() if callable(value) else value or "")
        except Exception:
            return ""

    def _safe_attr(self, element: Any, attr: str) -> Any:
        try:
            value = getattr(element, attr)
            return value() if callable(value) else value
        except Exception:
            return None

    def _safe_rect(self, element: Any) -> tuple[int, int, int, int] | None:
        try:
            rect = element.rectangle()
            return int(rect.left), int(rect.top), int(rect.right), int(rect.bottom)
        except Exception:
            return None

    def _node_to_dict(self, node: ControlNode | None) -> dict[str, Any] | None:
        if node is None:
            return None
        return self.privacy.mask_control_payload(
            {
                "name": node.name,
                "control_type": node.control_type,
                "class_name": node.class_name,
                "automation_id": node.automation_id,
                "rectangle": node.rectangle,
                "children": [self._node_to_dict(child) for child in node.children or []],
            }
        )
