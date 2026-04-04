from typing import Union

def safe_add(a: int, b: int) -> Union[int, float]:
    # Ensure inputs are numbers
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        raise TypeError("Both inputs must be numbers")
    
    return a + b
