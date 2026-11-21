import unittest
from transit_sensitivity import weighted_depth, mask_sensitivity, dilution_correct

class TransitTests(unittest.TestCase):
    def test_depth(self):
        depth,error=weighted_depth([1,1,.98,.98],[.01]*4,[0,0,1,1])
        self.assertAlmostEqual(depth,.02)
        self.assertGreater(error,0)
    def test_uncertainty_scaling(self):
        a=weighted_depth([1,1,.99,.99],[.01]*4,[0,0,1,1])
        b=weighted_depth([1,1,.99,.99],[.02]*4,[0,0,1,1])
        self.assertAlmostEqual(b[1],2*a[1])
    def test_missing_baseline(self):
        with self.assertRaises(ValueError):
            weighted_depth([1,1],[.01,.01],[1,1])
    def test_mask_width(self):
        r=mask_sensitivity([-2,-1,0,1,2],[1,1,.98,1,1],[.01]*5,0,[.2,1.1])
        self.assertGreater(r[0][1],r[1][1])
    def test_dilution(self):
        d,e=dilution_correct(.01,1,.001,.1)
        self.assertAlmostEqual(d,.02)
        self.assertGreater(e,0)
if __name__=="__main__": unittest.main()
