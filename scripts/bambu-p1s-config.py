"""Builds src/core/bake/bambu-p1s.json, the Bambu Studio project config embedded in every exported 3MF.

  python3 scripts/bambu-p1s-config.py <project_settings.config> <BambuStudio resources/profiles/BBL> > src/core/bake/bambu-p1s.json

<project_settings.config> comes from a 3MF that the Bambu Studio CLI exported with the P1S machine, the
0.20mm Standard process and one PLA Basic filament loaded; it gives the full key set. The CLI leaves
inherited values at their defaults, so every value is taken again from the fully resolved system profiles
(inherits + include chains), and the filament settings are repeated for the four AMS filaments.
"""
import json, os, sys

MACHINE, PROCESS, FILAMENT = 'Bambu Lab P1S 0.4 nozzle', '0.20mm Standard @BBL X1C', 'Bambu PLA Basic @BBL P1S 0.4 nozzle'
VARIANT, N = 'Direct Drive Standard', 4
# filament options (Preset::filament_options) that neither start with filament_ nor appear in the PLA profiles
FILAMENT_EXTRA = {'default_filament_colour', 'enable_overhang_bridge_fan', 'enable_pressure_advance', 'first_x_layer_fan_speed',
                  'first_x_layer_part_fan_speed', 'ironing_fan_speed', 'overhang_threshold_participating_cooling', 'pre_start_fan_time',
                  'pressure_advance'}
META = {'name', 'inherits', 'include', 'from', 'setting_id', 'instantiation', 'type', 'compatible_printers', 'compatible_prints',
        'compatible_printers_condition', 'filament_id', 'description', 'renamed_from', 'version', 'is_custom_defined'}

config, profiles = json.load(open(sys.argv[1])), sys.argv[2]

def resolve(name):
    path = next(p for p in (f'{profiles}/{s}/{name}.json' for s in ('machine', 'process', 'filament')) if os.path.exists(p))
    d = json.load(open(path))
    out = resolve(d['inherits']) if d.get('inherits') else {}
    for inc in d.get('include', []): out.update(resolve(inc))
    out.update(d)
    return out

for name in (MACHINE, PROCESS):
    for k, v in resolve(name).items():
        if k not in META and k in config: config[k] = v

fil = resolve(FILAMENT)
variants = fil.get('filament_extruder_variant', [VARIANT])
vi = variants.index(VARIANT) if VARIANT in variants else 0
for k, v in fil.items():
    if k in META or k not in config: continue
    if isinstance(v, list):
        one = v[vi] if len(variants) > 1 and len(v) == len(variants) else (v[0] if v else '')
        config[k] = [one] * N
    else:
        config[k] = v
per_filament = [k for k, v in config.items() if isinstance(v, list) and len(v) == 1 and (k.startswith('filament_') or k in fil or k in FILAMENT_EXTRA)]
for k in per_filament: config[k] = config[k] * N
config.update({
    'printer_settings_id': MACHINE, 'print_settings_id': PROCESS, 'filament_settings_id': [FILAMENT] * N,
    'filament_ids': [fil.get('filament_id', '')] * N, 'filament_extruder_variant': [VARIANT] * N,
    'filament_self_index': [str(i + 1) for i in range(N)], 'filament_colour': ['#FFFFFF'] * N,
    'different_settings_to_system': [''] * (N + 2), 'inherits_group': [''] * (N + 2),
    # the figurines rely on slicer supports (overhangs, pieces with floating regions); the process preset leaves them off
    'enable_support': '1',
})
config['different_settings_to_system'][0] = 'enable_support'
json.dump(config, sys.stdout, ensure_ascii=False, indent=0)
