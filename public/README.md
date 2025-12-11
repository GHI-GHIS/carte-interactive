# Carte Interactive Vicat

Carte interactive des établissements Vicat (béton, granulats, ciment) avec Mapbox GL JS.

## Structure des fichiers

```
carte-interactive/
├── index.html              # Page autonome (pour tests locaux)
├── css/
│   └── vicat-map.css       # Styles (217 lignes)
└── js/
    ├── establishments-data.js  # Données GeoJSON (187 lignes)
    └── vicat-map.js            # Logique principale (5608 lignes)
```

## Plan de mise en place

### Étape 1 : Préparer le repo GitHub

1. Aller sur https://github.com/GHI-GHIS/carte-interactive
2. Si le repo est **privé**, le passer en **public** :
   - Settings → General → Danger Zone → Change visibility → Make public

### Étape 2 : Uploader les fichiers

**Option A - Via l'interface GitHub :**
1. Cliquer sur "Add file" → "Upload files"
2. Glisser-déposer tous les fichiers de l'archive
3. Commit : "Initial setup - carte interactive"

**Option B - Via Git (recommandé) :**
```bash
cd carte-interactive
git init
git add .
git commit -m "Initial setup - carte interactive"
git remote add origin https://github.com/GHI-GHIS/carte-interactive.git
git push -u origin main
```

### Étape 3 : Activer GitHub Pages

1. Aller dans **Settings** → **Pages**
2. Source : **Deploy from a branch**
3. Branch : **main** / dossier **/ (root)**
4. Cliquer **Save**
5. Attendre 1-2 minutes

### Étape 4 : Vérifier le déploiement

L'URL sera : `https://ghi-ghis.github.io/carte-interactive/`

Tester que la carte s'affiche correctement.

### Étape 5 : Intégrer dans Drupal

Remplacer le bloc HTML actuel (~6000 lignes) par ce code (~50 lignes) :

```html
<!-- Carte Interactive Vicat - Chargée depuis GitHub Pages -->
<link rel="stylesheet" href="https://ghi-ghis.github.io/carte-interactive/css/vicat-map.css">

<!-- Dépendances Mapbox -->
<link href="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js"></script>
<script src="https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-directions/v4.0.0/mapbox-gl-directions.js"></script>
<link rel="stylesheet" href="https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-directions/v4.0.0/mapbox-gl-directions.css">
<link href="https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v5.0.0/mapbox-gl-geocoder.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v5.0.0/mapbox-gl-geocoder.min.js"></script>
<script src="https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-language/v1.0.0/mapbox-gl-language.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js"></script>

<!-- Structure HTML de la carte -->
<div id="loading-overlay">Chargement de la carte...</div>
<div id="map-container">
    <!-- Le contenu HTML sera injecté par le script -->
</div>

<!-- Scripts Vicat -->
<script src="https://ghi-ghis.github.io/carte-interactive/js/establishments-data.js"></script>
<script src="https://ghi-ghis.github.io/carte-interactive/js/vicat-map.js"></script>
```

> **Note :** Le HTML complet du sidebar est dans `index.html`. Tu peux soit l'inclure directement dans Drupal, soit modifier `vicat-map.js` pour qu'il génère dynamiquement le HTML.

## Mises à jour futures

Pour modifier la carte :

1. Modifier les fichiers localement
2. Push sur GitHub :
   ```bash
   git add .
   git commit -m "Description de la modification"
   git push
   ```
3. GitHub Pages se met à jour automatiquement (~1-2 min)
4. Le cache navigateur peut retarder l'affichage (Ctrl+F5 pour forcer)

## Fichiers de référence

- `html-structure.html` : Structure HTML extraite (pour référence)
- `html-body.txt` : Même contenu (backup)

## Contact

Projet maintenu par Florian / GHI-GHIS
