"""Builds src/core/bake/bambu/<printer>.json, the Bambu Studio project configs embedded in exported 3MFs.

  python3 scripts/bambu-config.py <project_settings.config> <BambuStudio resources/profiles/BBL> src/core/bake/bambu

<project_settings.config> comes from a 3MF that the Bambu Studio CLI exported with the P1S machine, the
0.20mm Standard process and one PLA Basic filament loaded; it gives the full key set. The CLI leaves
inherited values at their defaults, so every value is taken again from the fully resolved system profiles
(inherits + include chains) of each printer. Each file holds the config for ONE filament and the list of the
per-filament keys; the exporter repeats those for as many filaments as the creature needs (threemf.ts).
"""
import glob, json, os, sys

# printer id (plan.ts PRINTERS) -> machine, process, filament: the printer's own defaults in Bambu Studio
PRINTERS = {
    'p1s': ('Bambu Lab P1S 0.4 nozzle', '0.20mm Standard @BBL X1C', 'Bambu PLA Basic @BBL P1S 0.4 nozzle'),
    'p1p': ('Bambu Lab P1P 0.4 nozzle', '0.20mm Standard @BBL P1P', 'Bambu PLA Basic @BBL P1P'),
    'x1c': ('Bambu Lab X1 Carbon 0.4 nozzle', '0.20mm Standard @BBL X1C', 'Bambu PLA Basic @BBL X1C'),
    'p2s': ('Bambu Lab P2S 0.4 nozzle', '0.20mm Standard @BBL P2S', 'Bambu PLA Basic @BBL P2S'),
    'a1': ('Bambu Lab A1 0.4 nozzle', '0.20mm Standard @BBL A1', 'Bambu PLA Basic @BBL A1'),
    'a1mini': ('Bambu Lab A1 mini 0.4 nozzle', '0.20mm Standard @BBL A1M', 'Bambu PLA Basic @BBL A1M'),
}
VARIANT = 'Direct Drive Standard'
# filament options (Preset::filament_options) that neither start with filament_ nor appear in the PLA profiles
FILAMENT_EXTRA = {'default_filament_colour', 'enable_overhang_bridge_fan', 'enable_pressure_advance', 'first_x_layer_fan_speed',
                  'first_x_layer_part_fan_speed', 'ironing_fan_speed', 'overhang_threshold_participating_cooling', 'pre_start_fan_time',
                  'pressure_advance'}
META = {'name', 'inherits', 'include', 'from', 'setting_id', 'instantiation', 'type', 'compatible_printers', 'compatible_prints',
        'compatible_printers_condition', 'filament_id', 'description', 'renamed_from', 'version', 'is_custom_defined'}

template, profiles, out_dir = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
files = {}
for p in glob.glob(f'{profiles}/**/*.json', recursive=True):
    try: files.setdefault(json.load(open(p)).get('name'), p)
    except (ValueError, AttributeError): pass

def resolve(name):
    d = json.load(open(files[name]))
    out = resolve(d['inherits']) if d.get('inherits') else {}
    for inc in d.get('include', []): out.update(resolve(inc))
    out.update(d)
    return out

for pid, (machine, process, filament) in PRINTERS.items():
    config = json.loads(json.dumps(template))
    for name in (machine, process):
        for k, v in resolve(name).items():
            if k not in META and k in config: config[k] = v
    fil = resolve(filament)
    variants = fil.get('filament_extruder_variant', [VARIANT])
    vi = variants.index(VARIANT) if VARIANT in variants else 0
    for k, v in fil.items():
        if k in META or k not in config: continue
        config[k] = [v[vi] if len(variants) > 1 and len(v) == len(variants) else (v[0] if v else '')] if isinstance(v, list) else v
    config.update({
        'printer_settings_id': machine, 'print_settings_id': process, 'filament_settings_id': [filament],
        'filament_ids': [fil.get('filament_id', '')], 'filament_extruder_variant': [VARIANT], 'filament_self_index': ['1'],
        'filament_colour': ['#FFFFFF'],
        # the process preset's own list (the key is named differently in the project config): Bambu refuses a project
        # whose printer is not on it
        'print_compatible_printers': resolve(process).get('compatible_printers', []),
        # the figurines rely on slicer supports (overhangs, pieces with floating regions); the process preset leaves them off
        'enable_support': '1',
    })
    per_filament = [k for k, v in config.items() if isinstance(v, list) and len(v) == 1 and (k.startswith('filament_') or k in fil or k in FILAMENT_EXTRA)]
    with open(os.path.join(out_dir, f'{pid}.json'), 'w') as f:
        json.dump({'perFilament': per_filament, 'config': config}, f, ensure_ascii=False, indent=0)
    print(pid, config.get('printer_model'), config.get('printable_area'), len(per_filament), file=sys.stderr)
