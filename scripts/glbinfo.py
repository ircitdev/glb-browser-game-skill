"""Паспорт риг-модели и клипов GLB: треугольники, материалы, кости, длительность, совпадение костей.
python -I glbinfo.py model.glb [clip1.glb clip2.glb ...]"""
import io
import json
import pathlib
import struct
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def load(path):
    with open(path, "rb") as f:
        if f.read(4) != b"glTF":
            sys.exit(f"{path}: это не бинарный GLB")
        f.read(8)
        n, _ = struct.unpack("<II", f.read(8))
        return json.loads(f.read(n))


def joints(g):
    return [g["nodes"][j].get("name") for s in g.get("skins", []) for j in s["joints"]]


model_path, *clip_paths = sys.argv[1:] or sys.exit(__doc__)
g = load(model_path)
tris = 0
for mesh in g.get("meshes", []):
    for p in mesh["primitives"]:
        count = g["accessors"][p["indices"]]["count"] if "indices" in p else g["accessors"][p["attributes"]["POSITION"]]["count"]
        tris += count // 3
names = joints(g)
print(pathlib.Path(model_path).name)
print("  генератор:", g["asset"].get("generator"))
print("  обязательные расширения:", g.get("extensionsRequired", []))
print("  треугольников:", tris, "| материалов:", len(g.get("materials", [])), "| текстур:", len(g.get("images", [])))
print("  костей:", len(names), names[:6])
if not names:
    print("  ВНИМАНИЕ: скелета нет, анимации применить не к чему")
maps = sum(1 for m in g.get("materials", []) if "normalTexture" in m or "metallicRoughnessTexture" in m.get("pbrMetallicRoughness", {}))
print("  материалов с картами нормалей или металла:", maps)
for path in clip_paths:
    c = load(path)
    label = pathlib.Path(path).name
    if not c.get("animations"):
        print(f"{label}: анимаций нет")
        continue
    a = c["animations"][0]
    dur = max(c["accessors"][s["input"]]["max"][0] for s in a["samplers"])
    kinds = {}
    for ch in a["channels"]:
        kinds[ch["target"]["path"]] = kinds.get(ch["target"]["path"], 0) + 1
    clip_nodes = {c["nodes"][ch["target"]["node"]].get("name") for ch in a["channels"]}
    missing = sorted(n for n in clip_nodes if n not in set(names))
    print(f"{label}: {dur:.2f} с, каналы {kinds}, нет в скелете: {len(missing)} {missing[:5]}")
