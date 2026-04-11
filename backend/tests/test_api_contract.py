import asyncio

from backend.api import routes


def test_health_contract_shape():
    payload = asyncio.run(routes.health())
    assert isinstance(payload, dict)
    assert payload.get("status") == "ok"
    assert "app" in payload
    assert "version" in payload
    assert "privacy_mode" in payload


def test_tool_policy_endpoint_contract():
    payload = asyncio.run(routes.tool_policy_check("read_file"))
    assert isinstance(payload, dict)
    for key in ("tool", "allowed", "requires_confirmation", "reason"):
        assert key in payload
