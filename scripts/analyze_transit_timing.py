"""Reproducible SYNTHETIC ephemeris, O-C, and even/odd depth study.

Requires optional offline tools: numpy and matplotlib (for plots only).
Does not affect the zero-dependency browser application.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import sys

import numpy as np

# Allow execution as `python scripts/analyze_transit_timing.py` from any cwd.
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tools.transit_timing_diagnostics import (  # noqa: E402
    fit_linear_ephemeris,leave_one_epoch_out,even_odd_depth_test,
)


def run(output_dir:Path)->dict:
    rng=np.random.default_rng(20261018)
    epoch=np.array([i for i in range(32) if i not in {4,11,20,27}])
    sigma=np.full(epoch.size,0.0007)  # days, 60.48 seconds
    # Fixed synthetic periodic O-C perturbation, not a real TTV detection.
    times=2459000.0+3.271*epoch+0.0009*np.sin(2*np.pi*epoch/9.0)+rng.normal(0,sigma)
    depth_sigma=np.full(epoch.size,0.0003)  # relative flux
    depth=0.009+0.00025*(epoch%2==0)+rng.normal(0,depth_sigma)
    fit=fit_linear_ephemeris(epoch,times,sigma)
    loo=leave_one_epoch_out(epoch,times,sigma)
    parity=even_odd_depth_test(epoch,depth,depth_sigma)
    output_dir.mkdir(parents=True,exist_ok=True)
    with (output_dir/'transit_epochs.csv').open('w',newline='',encoding='utf-8') as f:
        w=csv.writer(f);w.writerow(['epoch','midtime_bjd_tdb_days','timing_sigma_days','oc_days','loo_oc_days','loo_z','depth_fraction','depth_sigma_fraction'])
        w.writerows(zip(epoch,times,sigma,fit.residual_days,loo.predictive_residual_days,loo.standardized_residual,depth,depth_sigma))
    summary={
        'data_class':'synthetic numerical demonstration; no measured transit times',
        'seed':20261018,'time_standard':'illustrative BJD_TDB days; not converted from UTC',
        'n_transits':int(len(epoch)),'injected_period_days':3.271,
        'injected_ttv_amplitude_days':0.0009,
        'fitted_period_days':fit.period_days,
        'fitted_period_formal_error_days':float(np.sqrt(fit.covariance[1,1])),
        'ephemeris_chi2':fit.chi2,'ephemeris_dof':fit.dof,
        'loo_rms_z':loo.rms_standardized_residual,
        'loo_max_absolute_z':loo.max_absolute_standardized_residual,
        'even_odd_depth_difference_fraction':parity.difference_even_minus_odd,
        'even_odd_depth_difference_error_fraction':parity.difference_error,
        'even_odd_depth_z':parity.z_score,
        'limitations':['fixed-epoch independent Gaussian timing errors assumed',
                       'unmodelled TTV biases linear ephemeris and formal covariance',
                       'even/odd test assumes independent depth estimates',
                       'no time-system conversion or barycentric correction'],
    }
    (output_dir/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        fig,ax=plt.subplots(figsize=(8,4))
        ax.errorbar(epoch,fit.residual_days*86400,yerr=sigma*86400,fmt='o')
        ax.axhline(0,linewidth=.8)
        ax.set(xlabel='Transit epoch',ylabel='Observed minus calculated (s)',title='Synthetic linear ephemeris residuals')
        fig.tight_layout();fig.savefig(output_dir/'oc.png',dpi=150);plt.close(fig)
        fig,ax=plt.subplots(figsize=(8,4))
        ax.errorbar(epoch,loo.standardized_residual,fmt='o')
        ax.axhline(0,linewidth=.8)
        ax.set(xlabel='Transit epoch',ylabel='Held-out O-C / predictive sigma',title='Synthetic leave-one-transit-out')
        fig.tight_layout();fig.savefig(output_dir/'loo.png',dpi=150);plt.close(fig)
        fig,ax=plt.subplots(figsize=(8,4))
        ax.errorbar(epoch,depth*1e6,yerr=depth_sigma*1e6,fmt='o')
        ax.set(xlabel='Transit epoch',ylabel='Injected depth (ppm)',title='Synthetic even/odd depth check')
        fig.tight_layout();fig.savefig(output_dir/'parity.png',dpi=150);plt.close(fig)
    except ImportError:
        pass
    return summary


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output-dir',type=Path,default=Path('results/transit_timing'))
    print(json.dumps(run(parser.parse_args().output_dir),indent=2))
