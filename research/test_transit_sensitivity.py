import unittest
from transit_sensitivity import integrated_box_depth,diluted_depth,radius_ratio_from_depth
class TransitTests(unittest.TestCase):
    def test_short_exposure(self): self.assertAlmostEqual(integrated_box_depth(.01,2,.1),.01)
    def test_long_exposure(self): self.assertAlmostEqual(integrated_box_depth(.01,1,2),.005)
    def test_outside(self): self.assertEqual(integrated_box_depth(.01,1,.2,2),0)
    def test_dilution(self): self.assertAlmostEqual(diluted_depth(.02,1),.01)
    def test_ratio(self): self.assertAlmostEqual(radius_ratio_from_depth(.01,0)[0],.1)
    def test_sigma(self): self.assertGreater(radius_ratio_from_depth(.01,.1,.001,.02)[1],0)
    def test_invalid(self):
        with self.assertRaises(ValueError): integrated_box_depth(-.1,1,1)
if __name__=='__main__': unittest.main()
