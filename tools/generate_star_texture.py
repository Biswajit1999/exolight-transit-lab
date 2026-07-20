#!/usr/bin/env python3
"""
ExoIntel-Prime photosphere granulation texture generator.

Generates a seamless, tileable equirectangular grayscale texture used as a
luminance/granulation map for the WebGL star shader (src/scene.js). The
shader tints this with the target's actual temperature-based colour
(uHotColour/uCoolColour/uBaseColour) and applies limb darkening on top, so
this texture only needs to carry the granulation *pattern*, not colour.

The pattern is built from two blended scales of wrapped Worley (cellular)
noise -- which gives the bright-cell / dark-boundary look of real solar
granulation -- plus large- and fine-scale fractal noise for organic,
non-uniform brightness variation.

Requirements: numpy, scipy, Pillow

Run:
    python tools/generate_star_texture.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "assets" / "textures" / "photosphere_granulation.png"
WIDTH, HEIGHT = 1024, 512


def _upsample_periodic(small: np.ndarray, h: int, w: int) -> np.ndarray:
    """Upsample a small random grid to (h, w) via zero-padded FFT, which keeps
    the result periodic (seamless when tiled) because it never touches phase."""
    sh, sw = small.shape
    spectrum = np.fft.fftshift(np.fft.fft2(small))
    padded = np.zeros((h, w), dtype=complex)
    y0, x0 = h // 2 - sh // 2, w // 2 - sw // 2
    padded[y0:y0 + sh, x0:x0 + sw] = spectrum
    out = np.fft.ifft2(np.fft.ifftshift(padded)).real
    out *= (h * w) / (sh * sw)
    return out


def fbm_noise(shape: tuple[int, int], octaves: int, persistence: float, seed: int) -> np.ndarray:
    h, w = shape
    total = np.zeros((h, w), dtype=np.float64)
    amp, amp_sum = 1.0, 0.0
    freq_h, freq_w = 4, 8
    rng = np.random.default_rng(seed)
    for _ in range(octaves):
        total += amp * _upsample_periodic(rng.random((freq_h, freq_w)), h, w)
        amp_sum += amp
        amp *= persistence
        freq_h, freq_w = min(freq_h * 2, h), min(freq_w * 2, w)
    total /= amp_sum
    total -= total.min()
    total /= total.max()
    return total


def worley_distances(shape: tuple[int, int], cells_y: int, cells_x: int, seed: int,
                      jitter: float, drop_prob: float) -> tuple[np.ndarray, np.ndarray]:
    """Distance to nearest and second-nearest jittered cell point. Points are
    tiled into the 8 neighbouring wrap copies before the KD-tree query, so a
    single tree lookup gives correct wrap-around (seamless) distances."""
    h, w = shape
    rng = np.random.default_rng(seed)
    points = []
    for cy in range(cells_y):
        for cx in range(cells_x):
            if drop_prob and rng.random() < drop_prob:
                continue
            jy = (cy + 0.5 + jitter * (rng.random() - 0.5) * 2) / cells_y * h
            jx = (cx + 0.5 + jitter * (rng.random() - 0.5) * 2) / cells_x * w
            points.append((jy, jx))
    points = np.array(points)

    tiled = np.concatenate([points + np.array([oy * h, ox * w])
                             for oy in (-1, 0, 1) for ox in (-1, 0, 1)], axis=0)
    tree = cKDTree(tiled)
    yy, xx = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
    query = np.stack([yy.ravel(), xx.ravel()], axis=1)
    dists, _ = tree.query(query, k=2, workers=-1)
    return dists[:, 0].reshape(h, w), dists[:, 1].reshape(h, w)


def granulation_layer(shape, cells_y, cells_x, seed, jitter=0.85, drop_prob=0.18,
                       edge_sharp=6.0, edge_pow=1.5) -> np.ndarray:
    dmin, dmin2 = worley_distances(shape, cells_y, cells_x, seed, jitter, drop_prob)
    cell_gap = dmin2 - dmin
    cell_gap /= cell_gap.max() + 1e-9
    brightness = 1.0 - np.clip(dmin / (dmin.max() * 0.55), 0, 1)
    dark_edge = np.clip(1.0 - cell_gap * edge_sharp, 0, 1) ** edge_pow
    return brightness - 0.65 * dark_edge


def main() -> None:
    shape = (HEIGHT, WIDTH)
    coarse = granulation_layer(shape, cells_y=15, cells_x=30, seed=3)
    fine_cells = granulation_layer(shape, cells_y=26, cells_x=52, seed=5)
    granulation = 0.45 * coarse + 0.55 * fine_cells

    large_scale = fbm_noise(shape, octaves=5, persistence=0.55, seed=11)
    fine_scale = fbm_noise(shape, octaves=7, persistence=0.5, seed=21)

    result = 0.68 * granulation + 0.22 * (large_scale - 0.5) + 0.10 * (fine_scale - 0.5)
    result -= result.min()
    result /= result.max()
    result = np.clip(result, 0, 1) ** 0.92

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray((result * 255).astype(np.uint8), mode="L").save(OUTPUT_PATH)
    print(f"Wrote {OUTPUT_PATH.relative_to(ROOT)} ({WIDTH}x{HEIGHT})")


if __name__ == "__main__":
    main()
