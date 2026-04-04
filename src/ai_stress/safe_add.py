# ai_stress/safe_add.py

def safe_add(a, b):
    """Returns the sum of a and b without overflowing."""
    return (a + b) % 2**32
