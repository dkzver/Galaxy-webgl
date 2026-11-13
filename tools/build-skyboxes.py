"""Собрать skybox-панорамы для игры.

Источники лежат в assets/ (equirect-панорамы 2:1). На выходе для каждой
панорамы:

* public/skyboxes/cube/<id>-{px,nx,py,ny,pz,nz}.jpg — шесть граней кубемапы;
* public/skyboxes/<id>.jpg — equirect-превью для редактора;
* public/skyboxes/<id>-thumb.jpg — миниатюра для списка.

Кубемапа выбрана специально: у equirect-текстуры шов на азимуте склейки и
сингулярность на полюсах, а грани стыкуются без разрыва и без растяжения.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "skyboxes"
CUBE = OUT / "cube"
PREVIEW = (2048, 1024)
THUMB = (320, 160)
QUALITY = 86

# Порядок граней совпадает с GL: +X, -X, +Y, -Y, +Z, -Z.
FACES = ("px", "nx", "py", "ny", "pz", "nz")

SOURCES = [
    (
        "alien-nebula-1",
        "Alien Space Nebula 1",
        "assets/alien-space-nebula-1-skybox/textures/alien-space-nebula_7680x3840.png",
        None,
        1024,
    ),
    (
        "alien-nebula-2",
        "Alien Space Nebula 2",
        "assets/alien-space-nebula-2-skybox/textures/Alien Space Nebula 4xup.png",
        None,
        1024,
    ),
    (
        "alien-nebula-3",
        "Alien Space Nebula 3",
        "assets/alien_space_nebula_1_skybox/textures/Material_baseColor.png",
        None,
        1024,
    ),
    (
        "alien-nebula-4",
        "Alien Space Nebula 4",
        "assets/alien_space_nebula_2_skybox/textures/Material_emissive.png",
        None,
        1024,
    ),
    # Реальная панорама ESO/S. Brunier (CC BY 4.0), 6000x3000, без звёзд.
    (
        "realistic-milkyway",
        "Realistic Milky Way",
        "assets/skybox-5/eso-original.jpg",
        "starless",
        2048,
    ),
]


def strip_stars(image: Image.Image) -> Image.Image:
    """Убрать точечные источники, оставив газ и пыль Млечного Пути.

    Звёзды ищутся разностью гауссиан: точечный источник даёт всплеск на малом
    масштабе, туманность — нет. Найденные пятна заливаются inpaint'ом, затем
    снимается цветное зерно, иначе звёздное поле превращается в шум.
    """
    import cv2

    bgr = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)

    # Первый проход: основная масса звёзд. Второй — редкие крупные с ореолами,
    # их маска должна быть шире, но inpaint мягче, иначе на небе остаются пятна.
    for sigma_small, sigma_large, scale, dilate, radius in ((1.0, 3.2, 4.0, 5, 4),):
        dog = cv2.GaussianBlur(gray, (0, 0), sigma_small) - cv2.GaussianBlur(gray, (0, 0), sigma_large)
        noise = 1.4826 * float(np.median(np.abs(dog - np.median(dog))))
        mask = (dog > max(4.5, noise * scale)).astype(np.uint8) * 255
        mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate, dilate)))
        bgr = cv2.inpaint(bgr, mask, radius, cv2.INPAINT_TELEA)

    specks = cv2.morphologyEx(
        cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY),
        cv2.MORPH_TOPHAT,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
    )
    mask = (specks > 20).astype(np.uint8) * 255
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    bgr = cv2.inpaint(bgr, mask, 2, cv2.INPAINT_TELEA)

    clean = cv2.fastNlMeansDenoisingColored(bgr, None, 3, 7, 7, 21)

    # Резкость: без неё inpaint превращает газ в мыло.
    lab = cv2.cvtColor(clean, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.GaussianBlur(l, (0, 0), 1.0)
    blur = cv2.GaussianBlur(l, (0, 0), 2.2)
    l = cv2.addWeighted(l, 1.55, blur, -0.55, 0)
    lut = np.array(
        [min(255, int(round((i / 255.0) ** 0.92 * 255))) for i in range(256)],
        dtype=np.uint8,
    )
    l = cv2.LUT(l, lut)
    clean = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)
    return Image.fromarray(cv2.cvtColor(clean, cv2.COLOR_BGR2RGB))


def cube_faces(image: Image.Image, size: int) -> dict[str, Image.Image]:
    """Нарезать equirect-панораму на шесть граней кубемапы.

    Направление для пикселя грани берётся по таблице соответствия OpenGL,
    затем переводится в долготу/широту панорамы. По горизонтали панорама
    предварительно расширена на несколько пикселей с противоположного края,
    поэтому на стыке 0/360 не появляется разрыв.
    """
    import cv2

    panorama = np.asarray(image.convert("RGB"))
    height, width = panorama.shape[:2]
    pad = 8
    padded = np.concatenate([panorama[:, -pad:], panorama, panorama[:, :pad]], axis=1)

    step = 2.0 / size
    s = np.tile((np.arange(size) + 0.5) * step - 1.0, (size, 1)).astype(np.float32)
    t = np.tile(((np.arange(size) + 0.5) * step - 1.0)[:, None], (1, size)).astype(np.float32)

    one = np.ones_like(s)
    directions = {
        "px": (one, -t, -s),
        "nx": (-one, -t, s),
        "py": (s, one, t),
        "ny": (s, -one, -t),
        "pz": (s, -t, one),
        "nz": (-s, -t, -one),
    }

    faces = {}
    for name, (dx, dy, dz) in directions.items():
        direction = np.stack([dx, dy, dz]).astype(np.float32)
        direction /= np.linalg.norm(direction, axis=0, keepdims=True)

        u = np.arctan2(direction[2], direction[0]) / (2.0 * np.pi) + 0.5
        v = np.arccos(np.clip(direction[1], -1.0, 1.0)) / np.pi

        map_x = (u * width - 0.5 + pad).astype(np.float32)
        map_y = np.clip(v * height - 0.5, 0, height - 1).astype(np.float32)

        face = cv2.remap(
            padded,
            map_x,
            map_y,
            interpolation=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )
        faces[name] = Image.fromarray(face)
    return faces


def seam_error(faces: dict[str, Image.Image]) -> float:
    """Насколько расходятся общие края соседних граней (0 — идеальный стык)."""
    arrays = {name: np.asarray(face, dtype=np.int16) for name, face in faces.items()}
    pairs = (
        (arrays["px"][:, -1], arrays["nz"][:, 0]),
        (arrays["px"][:, 0], arrays["pz"][:, -1]),
        (arrays["py"][-1, :], arrays["pz"][0, :]),
        (arrays["ny"][0, :], arrays["pz"][-1, :]),
    )
    return max(float(np.abs(a - b).mean()) for a, b in pairs)


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    CUBE.mkdir(parents=True, exist_ok=True)
    entries = []

    for skybox_id, title, relative, processing, face_size in SOURCES:
        image = Image.open(ROOT / relative).convert("RGB")
        if processing == "starless":
            image = strip_stars(image)

        faces = cube_faces(image, face_size)
        for name, face in faces.items():
            face.save(
                CUBE / f"{skybox_id}-{name}.jpg",
                "JPEG",
                quality=QUALITY,
                optimize=True,
                progressive=True,
            )

        preview = image.copy()
        preview.thumbnail(PREVIEW, Image.LANCZOS)
        preview.save(OUT / f"{skybox_id}.jpg", "JPEG", quality=84, optimize=True, progressive=True)

        thumb = image.copy()
        thumb.thumbnail(THUMB, Image.LANCZOS)
        thumb.save(OUT / f"{skybox_id}-thumb.jpg", "JPEG", quality=80, optimize=True, progressive=True)

        entries.append({
            "id": skybox_id,
            "title": title,
            "file": f"skyboxes/{skybox_id}.jpg",
            "thumb": f"skyboxes/{skybox_id}-thumb.jpg",
            "cube": f"skyboxes/cube/{skybox_id}",
            "faceSize": face_size,
        })
        size = sum((CUBE / f"{skybox_id}-{name}.jpg").stat().st_size for name in FACES)
        print(f"{skybox_id}: грани {face_size}px, {size} bytes, стык max {seam_error(faces):.1f}")

    import json

    (OUT / "index.json").write_text(
        json.dumps({"skyboxes": entries}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"index.json: {len(entries)} entries")


if __name__ == "__main__":
    build()
