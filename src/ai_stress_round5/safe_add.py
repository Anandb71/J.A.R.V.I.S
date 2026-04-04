# C:\Users\anand\Repos\Jarvis\src\ai_stress_round5\safe_add.py

def safe_add(a, b):
    """Returns the sum of a and b while ensuring overflow is handled."""
    return (a + b) % 2**32
