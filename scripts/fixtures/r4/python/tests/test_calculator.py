import unittest
from calculator import sum_values


class CalculatorTest(unittest.TestCase):
    def test_sums_empty_signed_and_multiple_values(self):
        self.assertEqual(sum_values([]), 0)
        self.assertEqual(sum_values([1, 2, 3]), 6)
        self.assertEqual(sum_values([-3, 3]), 0)
