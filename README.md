# Solution Building Block Demo

**ID:** `009999` · **Arquitecto:** AS117

Descripción de la Solution.

## Estructura

```text
.
├── source/
│   └── design.archimate
├── thumbnails/
│   └── .gitkeep
├── manifest.json
└── README.md
```

`source/design.archimate` es el modelo ArchiMate editable. `manifest.json` contiene los metadatos e inventario del SBB.

## Primeros pasos

- Edita `source/design.archimate` con una herramienta compatible con ArchiMate.

- Al subir cambios a `master`, GitHub Actions procesa las vistas, publica sus miniaturas y actualiza `manifest.json`.

- Las vistas vacías se registran sin imagen; si el modelo no contiene vistas, las miniaturas existentes se conservan.

`manifest.json` nunca se edita, este archivo se genera y actualizad de manera automatica con GitHub.
