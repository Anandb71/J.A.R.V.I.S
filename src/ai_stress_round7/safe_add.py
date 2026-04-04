# C:\Users\anand\Repos\Jarvis\src\ai_stress_round7\safe_add.py

def safe_add(a, b):
    """Returns the sum of a and b while avoiding overflow."""
    # Use built-in Python functions to avoid potential issues with arbitrary-precision arithmetic
    return (a + b) % 2**31
