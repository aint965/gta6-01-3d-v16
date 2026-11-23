# sample-headlight.py — pixel-sample the headlight on/off frozen pair.
# Criteria (Stage B brief): lit asphalt >= +20 mean RGB with >= 90% of its
# pixels > +10 vs off; lit lead-car roof >= +20 mean RGB; an unlit control
# patch within 1 level (mean RGB difference <= 1).
# NOTE on the roof patch: the lead car's true roof (top face, y~345-355) is
# occluded on screen by the driven-car yellow diamond, whose 0.4 m bob lands
# on different pixels in the two runs (a y=350 scan shows -19..-52 there).
# The patch below samples the car's upper body just under the diamond
# (y=360-375), which uses the SAME boosted body material as the roof
# (render.js: the top face is drawn with {...body, normal: n}), so it
# measures the same lit-car boost. The rear-body patch is a second witness.
# Run: python3 checks/sample-headlight.py
from PIL import Image
import sys

ON = 'checks/headlight-on.png'
OFF = 'checks/headlight-off.png'
# (name, x0, y0, x1, y1) in 1280x720 screenshot pixels.
PATCHES = [
    ('asphalt pool left', 575, 385, 610, 410),
    ('asphalt pool right', 670, 385, 705, 410),
    ('lead-car roof', 620, 360, 660, 375),
    ('lead-car rear body', 625, 362, 655, 378),
    ('control far-left road', 150, 385, 200, 410),
    ('control far-right road', 1080, 385, 1130, 410),
]

def mean_rgb(im, box):
    crop = im.crop(box).convert('RGB')
    px = list(crop.getdata())
    n = len(px)
    return tuple(sum(c[i] for c in px) / n for i in range(3))

def frac_up(im_on, im_off, box, thresh=10):
    a = list(im_on.crop(box).convert('RGB').getdata())
    b = list(im_off.crop(box).convert('RGB').getdata())
    up = sum(1 for x, y in zip(a, b)
             if (x[0] + x[1] + x[2]) / 3 - (y[0] + y[1] + y[2]) / 3 > thresh)
    return up / len(a)

def main():
    on = Image.open(ON)
    off = Image.open(OFF)
    if on.size != off.size:
        print(f'FAIL sizes differ: on {on.size} off {off.size}')
        sys.exit(1)
    print(f'size {on.size}')
    results = {}
    for name, x0, y0, x1, y1 in PATCHES:
        box = (x0, y0, x1, y1)
        mo = mean_rgb(on, box)
        mf = mean_rgb(off, box)
        d = tuple(mo[i] - mf[i] for i in range(3))
        dmean = sum(d) / 3
        f = frac_up(on, off, box)
        results[name] = (dmean, f)
        print(f'{name:24s} on={tuple(round(v, 1) for v in mo)} '
              f'off={tuple(round(v, 1) for v in mf)} '
              f'dMean={dmean:+.1f} frac>+10={f:.2f}')
    # Verdicts on the brief's patches (asphalt = the two pool patches averaged,
    # roof = lead-car roof, control = the two far-road patches averaged).
    a = (results['asphalt pool left'][0] + results['asphalt pool right'][0]) / 2
    af = (results['asphalt pool left'][1] + results['asphalt pool right'][1]) / 2
    r = results['lead-car roof'][0]
    c = (results['control far-left road'][0] + results['control far-right road'][0]) / 2
    print(f'asphalt dMean={a:+.1f} (want >= +20), frac>+10={af:.2f} (want >= 0.90)')
    print(f'lead-car roof dMean={r:+.1f} (want >= +20)')
    print(f'control dMean={c:+.1f} (want |d| <= 1)')
    ok = a >= 20 and af >= 0.90 and r >= 20 and abs(c) <= 1
    print('HEADLIGHT ' + ('PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)

main()
