/**
 * Vicat Interactive Map
 * https://github.com/GHI-GHIS/carte-interactive
 */

// Configuration
mapboxgl.accessToken = 'pk.eyJ1IjoiZ2hpc2xhaW5sZXZyYXQiLCJhIjoiY20ydW9zZjc3MDNkeTJpczVkbzViYWNwMCJ9.BLWt3SPO0Qt0cOQmLHrzrQ';

// Variables globales
let map;
let currentView3DCoordinates = null; // Pour tracker l'UP actuellement en vue 3D
let zoomingToCoordinates = null; // Pour tracker vers quelle UP on est en train de zoomer
let geocoder;
let directions;
let currentSearchCenter = null;
let currentSearchRadius = 80;
let currentLayoutMode = 'dual';
let currentMode = 'normal'; // Mode normal ou route
let primaryFilteredFeatures = [];
let userLocationMarker = null; // Marker pour la géolocalisation
let currentMapboxMarkers = [];
let activePopups = [];
let debounceTimer;
let currentRouteSource = null;
const VIEW_MODE_THRESHOLD = 700;

// Nouvelles variables pour les améliorations
let sortByDistance = true;

// Filtrage par légende interactive - Initialement aucun filtre actif (tout est affiché)
let activeFilters = new Set();

// Variables pour l'itinéraire
let destinationCoords = null;
let routeMode = false;
let currentFocusedInput = 'A'; // Track which input (A or B) has focus
let geocoderB = null; // Geocoder pour le Point B
let realRouteData = null; // Stocker les données réelles de routage (distance et temps)
let isRouteMode = false; // Tracker si on est en mode itinéraire pour contrôler l'affichage du rayon

// Variables pour stocker les features des points sélectionnés
let currentPointAFeature = null; // Feature complète du Point A
let currentPointBFeature = null; // Feature complète du Point B
let isPointAFromUP = false; // Indique si Point A est une UP
let isPointBFromUP = false; // Indique si Point B est une UP

// Fonction pour mapper les activités vers les types de légende
function getActivityType(activity) {
    const activityLower = activity?.toLowerCase() || '';
    if (activityLower.includes('béton') || activityLower.includes('beton')) return 'beton';
    if (activityLower.includes('granulat')) return 'granulats';
    // Tester "ciment prompt" en PREMIER pour éviter le conflit avec "ciment"
    if (activityLower.includes('ciment prompt') || activityLower.includes('prompt')) return 'ciment-prompt';
    if (activityLower.includes('ciment')) return 'ciment';
    return 'ciment'; // Par défaut
}

// Fonction pour convertir les caractères accentués en Unicode dans les données
function convertToUnicodeEscapes(obj) {
    if (typeof obj === 'string') {
        // Remplacer tous les caractères accentués par leurs codes Unicode
        return obj
            .replace(/é/g, '\u00E9')
            .replace(/É/g, '\u00C9')
            .replace(/è/g, '\u00E8')
            .replace(/È/g, '\u00C8')
            .replace(/à/g, '\u00E0')
            .replace(/À/g, '\u00C0')
            .replace(/ù/g, '\u00F9')
            .replace(/Ù/g, '\u00D9')
            .replace(/ô/g, '\u00F4')
            .replace(/Ô/g, '\u00D4')
            .replace(/ç/g, '\u00E7')
            .replace(/Ç/g, '\u00C7')
            .replace(/â/g, '\u00E2')
            .replace(/Â/g, '\u00C2')
            .replace(/ê/g, '\u00EA')
            .replace(/Ê/g, '\u00CA')
            .replace(/î/g, '\u00EE')
            .replace(/Î/g, '\u00CE')
            .replace(/û/g, '\u00FB')
            .replace(/Û/g, '\u00DB')
            .replace(/ï/g, '\u00EF')
            .replace(/Ï/g, '\u00CF')
            .replace(/ë/g, '\u00EB')
            .replace(/Ë/g, '\u00CB')
            .replace(/ü/g, '\u00FC')
            .replace(/Ü/g, '\u00DC')
            .replace(/œ/g, '\u0153')
            .replace(/Œ/g, '\u0152')
            .replace(/æ/g, '\u00E6')
            .replace(/Æ/g, '\u00C6');
    } else if (Array.isArray(obj)) {
        return obj.map(item => convertToUnicodeEscapes(item));
    } else if (obj !== null && typeof obj === 'object') {
        const result = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                result[key] = convertToUnicodeEscapes(obj[key]);
            }
        }
        return result;
    }
    return obj;
}

// DONNÉES CHARGÉES DEPUIS establishments-data.js
// La variable establishmentsDataRaw doit être définie avant ce script

// Convertir automatiquement tous les caractères accentués en Unicode
const establishmentsData = convertToUnicodeEscapes(establishmentsDataRaw);

// Ajouter des IDs uniques aux features
establishmentsData.features.forEach((feature, index) => {
    feature.properties.id = feature.properties.UP + '_' + index;
});

// Fonctions utilitaires
function debounce(func, wait) {
    return function executedFunction(...args) {
        const later = () => { clearTimeout(debounceTimer); func(...args); };
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(later, wait);
    };
}
function decodeHTMLEntities(text) {
    if (typeof text !== 'string') return text;
    // Retourner le texte directement sans décoder les entités HTML
    // car les données sont déjà en UTF-8 et non en entités HTML
    return text;
}
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function findNearbyUPs(coordinates, radiusKm) {
    const nearbyUPs = [];
    if (!establishmentsData || !establishmentsData.features) return nearbyUPs;
    
    establishmentsData.features.forEach((feature) => {
        const distance = calculateDistance(
            coordinates[1], coordinates[0],
            feature.geometry.coordinates[1], feature.geometry.coordinates[0]
        );
        
        if (distance <= radiusKm) {
            nearbyUPs.push({
                feature: feature,
                distance: distance
            });
        }
    });
    
    // Trier par distance
    nearbyUPs.sort((a, b) => a.distance - b.distance);
    
    return nearbyUPs;
}

function localUPGeocoder(query) {
    if (!query || query.length < 2) {
        return [];
    }
    
    if (!establishmentsData || !establishmentsData.features) {
        return [];
    }
    
    const results = [];
    const queryLower = query.toLowerCase();
    
    // Chercher dans les UP
    establishmentsData.features.forEach((feature, index) => {
        if (results.length >= 5) return;
        
        if (feature.properties.UP && feature.properties.UP.toLowerCase().includes(queryLower)) {
            const upName = decodeHTMLEntities(feature.properties.UP);
            const address = decodeHTMLEntities(feature.properties.Adresse || '');
            const city = decodeHTMLEntities(feature.properties.Ville || '');
            
            results.push({
                id: `local-up-${index}`,
                type: 'Feature',
                place_type: ['place'],
                relevance: 1.0,
                text: `[UP] ${upName}`,
                place_name: `📍 ${upName}, ${address}, ${city}`,
                center: feature.geometry.coordinates,
                geometry: feature.geometry,
                properties: feature.properties,
                context: []
            });
        }
    });
    
    // Chercher dans les villes si pas assez de résultats
    if (results.length < 3) {
        establishmentsData.features.forEach((feature, index) => {
            if (results.length >= 5) return;
            
            if (feature.properties.Ville && 
                feature.properties.Ville.toLowerCase().includes(queryLower) &&
                !results.some(r => r.properties && r.properties.UP === feature.properties.UP)) {
                
                const upName = decodeHTMLEntities(feature.properties.UP);
                const city = decodeHTMLEntities(feature.properties.Ville || '');
                
                results.push({
                    id: `local-city-${index}`,
                    type: 'Feature',
                    place_type: ['place'],
                    relevance: 0.8,
                    text: `[UP] ${upName}`,
                    place_name: `📍 ${upName} • ${city}`,
                    center: feature.geometry.coordinates,
                    geometry: feature.geometry,
                    properties: feature.properties,
                    context: []
                });
            }
        });
    }
    
    return results;
}

// Définition des régions françaises avec leurs coordonnées approximatives
const regions = {
    'Auvergne-Rhône-Alpes': { center: [5.7301, 45.3584], bounds: [[3.8, 44.0], [7.7, 46.8]] },
    'Bourgogne-Franche-Comté': { center: [5.0301, 47.0584], bounds: [[2.8, 46.0], [7.2, 48.5]] },
    'Nouvelle-Aquitaine': { center: [0.8301, 45.3584], bounds: [[-2.0, 42.0], [3.0, 47.0]] },
    'Occitanie': { center: [2.3301, 43.5584], bounds: [[-1.0, 42.0], [5.0, 45.0]] },
    'Grand Est': { center: [6.2301, 49.0584], bounds: [[4.0, 47.5], [8.5, 50.5]] },
    'Hauts-de-France': { center: [2.8301, 50.1584], bounds: [[1.0, 49.0], [4.5, 51.5]] },
    'Normandie': { center: [0.2301, 49.0584], bounds: [[-2.0, 48.0], [2.0, 50.0]] },
    'Île-de-France': { center: [2.3488, 48.8534], bounds: [[1.4, 48.1], [3.6, 49.2]] },
    'Centre-Val de Loire': { center: [1.8301, 47.2584], bounds: [[0.0, 46.0], [3.5, 48.5]] },
    'Pays de la Loire': { center: [-1.1699, 47.4584], bounds: [[-2.5, 46.0], [0.5, 48.5]] },
    'Bretagne': { center: [-3.1699, 48.2584], bounds: [[-5.5, 47.0], [-1.0, 49.0]] },
    'Provence-Alpes-Côte d\'Azur': { center: [6.2301, 43.9584], bounds: [[4.2, 43.0], [7.7, 45.0]] },
    'Corse': { center: [9.1301, 42.1584], bounds: [[8.5, 41.3], [9.8, 43.1]] },
    'Languedoc-Roussillon': { center: [3.8301, 43.6584], bounds: [[1.7, 42.3], [4.9, 44.9]] }
};

function getRegionForCoordinates(lng, lat) {
    for (const [regionName, regionData] of Object.entries(regions)) {
        const [[minLng, minLat], [maxLng, maxLat]] = regionData.bounds;
        if (lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat) {
            return regionName;
        }
    }
    return 'Autre région';
}


function calculateTravelTime(distance) {
    // Calcul avec fourchette : temps optimiste (70 km/h) et pessimiste (40 km/h)
    const minHours = distance / 70; // Conditions idéales
    const maxHours = distance / 40; // Conditions difficiles (ville, traffic)
    
    const minMinutes = Math.round(minHours * 60 / 5) * 5; // Arrondir aux 5 min
    const maxMinutes = Math.round(maxHours * 60 / 5) * 5;
    
    if (maxMinutes < 60) {
        if (minMinutes === maxMinutes) {
            return `${minMinutes} min`;
        }
        return `${minMinutes}-${maxMinutes} min`;
    } else {
        const minH = Math.floor(minMinutes / 60);
        const minM = minMinutes % 60;
        const maxH = Math.floor(maxMinutes / 60);
        const maxM = maxMinutes % 60;
        
        if (minH === maxH && minM === maxM) {
            return minM > 0 ? `${minH}h${minM}` : `${minH}h`;
        }
        
        const minStr = minM > 0 ? `${minH}h${minM}` : `${minH}h`;
        const maxStr = maxM > 0 ? `${maxH}h${maxM}` : `${maxH}h`;
        return `${minStr}-${maxStr}`;
    }
}

function addClusterLayers() {
    // Cluster circles
    map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'establishments',
        filter: ['has', 'point_count'],
        paint: {
            'circle-color': [
                'step',
                ['get', 'point_count'],
                '#555',     // cluster-small (gris moyen)
                10, '#333', // cluster-medium (gris foncé)
                50, '#222'  // cluster-large (gris très foncé)
            ],
            'circle-radius': [
                'step',
                ['get', 'point_count'],
                17, // cluster-small (35px/2 = 17.5)
                10, 22, // cluster-medium (45px/2 = 22.5)
                50, 27  // cluster-large (55px/2 = 27.5)
            ],
            'circle-stroke-width': 3,
            'circle-stroke-color': '#fff'
        }
    });

    // Cluster count labels
    map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'establishments',
        filter: ['has', 'point_count'],
        layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 14
        },
        paint: {
            'text-color': '#fff'
        }
    });

    // Individual points (unclustered)
    map.addLayer({
        id: 'unclustered-point',
        type: 'symbol',
        source: 'establishments',
        filter: ['!', ['has', 'point_count']],
        layout: {
            'icon-image': [
                'case',
                ['==', ['get', 'activity'], 'beton'], 'beton-marker',
                ['==', ['get', 'activity'], 'granulats'], 'granulats-marker',
                ['==', ['get', 'activity'], 'ciment'], 'ciment-marker',
                ['==', ['get', 'activity'], 'ciment-prompt'], 'ciment-prompt-marker',
                'beton-marker'
            ],
            'icon-size': 1.0,   // Taille normale car images redimensionnées à 32x32
            'icon-allow-overlap': true
        }
    });
}

function loadMarkerImages(callback) {
    const markers = {
        'beton-marker': 'https://www.solutions-vicat.fr/sites/default/files/2024-09/point-interet-beton.png',
        'granulats-marker': 'https://www.solutions-vicat.fr/sites/default/files/2024-09/point-interet-granulats.png',
        'ciment-marker': 'https://www.solutions-vicat.fr/sites/default/files/2024-09/point-interet-ciment.png',
        'ciment-prompt-marker': 'https://www.solutions-vicat.fr/sites/default/files/2024-12/ciment-prompt-naturel.png'
    };
    
    const markerIds = Object.keys(markers);
    let loadedCount = 0;
    
    const checkComplete = () => {
        loadedCount++;
        if (loadedCount === markerIds.length && callback) {
            callback();
        }
    };
    
    Object.entries(markers).forEach(([id, url]) => {
        // Utiliser map.loadImage() directement (pas de problème CORS sur solutions-vicat.fr)
        map.loadImage(url, (error, image) => {
            if (error) {
                // Fallback avec icône SVG
                createSVGMarkerIcon(id, getColorForMarker(id), getSymbolForMarker(id));
            } else {
                // Redimensionner l'image si elle est trop grande
                const resizedImage = resizeImageForMap(image, 32, 32);
                
                if (!map.hasImage(id)) {
                    map.addImage(id, resizedImage);
                }
            }
            checkComplete();
        });
    });
}

function resizeImageForMap(image, targetWidth, targetHeight) {
    // Si l'image est déjà petite, la retourner telle quelle
    if (image.data && image.data.width <= targetWidth && image.data.height <= targetHeight) {
        return image;
    }
    
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        
        // Créer une image HTML temporaire pour le redimensionnement
        const tempImg = new Image();
        tempImg.width = image.data ? image.data.width : targetWidth;
        tempImg.height = image.data ? image.data.height : targetHeight;
        
        // Si c'est un ImageBitmap ou ImageData, nous devons convertir différemment
        if (image.data) {
            // Créer ImageData à partir des données
            const imageData = new ImageData(image.data.data, image.data.width, image.data.height);
            
            // Créer un canvas temporaire avec l'image originale
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = image.data.width;
            tempCanvas.height = image.data.height;
            tempCtx.putImageData(imageData, 0, 0);
            
            // Redimensionner sur le canvas final
            ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
        } else {
            // Pour les autres formats, essayer de dessiner directement
            ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
        }
        
        // Retourner les données d'image redimensionnées
        const resizedImageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        return resizedImageData;
        
    } catch (e) {
        // Retourner l'image originale en cas d'erreur
        return image;
    }
}

function getColorForMarker(id) {
    const colors = {
        'beton-marker': '#4CAF50',
        'granulats-marker': '#FF9800',
        'ciment-marker': '#2196F3',
        'ciment-prompt-marker': '#9C27B0'
    };
    return colors[id] || '#666';
}

function getSymbolForMarker(id) {
    const symbols = {
        'beton-marker': 'B',
        'granulats-marker': 'G',
        'ciment-marker': 'C',
        'ciment-prompt-marker': 'P'
    };
    return symbols[id] || '?';
}

function createSVGMarkerIcon(id, color, symbol) {
    const size = 32;  // Même taille que les images redimensionnées
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Dessiner une icône simple et cohérente
    // Ombre légère
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(size/2 + 1, size - 2, 8, 3, 0, 0, 2 * Math.PI);
    ctx.fill();
    
    // Corps principal (cercle simple)
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size/2, size/2, 10, 0, Math.PI * 2);
    ctx.fill();
    
    // Bordure blanche fine
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(size/2, size/2, 10, 0, Math.PI * 2);
    ctx.stroke();
    
    // Texte au centre
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbol, size/2, size/2);
    
    // Ajouter l'image à Mapbox
    const imageData = ctx.getImageData(0, 0, size, size);
    if (!map.hasImage(id)) {
        map.addImage(id, imageData);
    }
}

function createFallbackMarker(id) {
    // Créer un marqueur de base visible
    const size = 40;  // Taille augmentée
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Dessiner un cercle de couleur selon le type
    const colors = {
        'beton-marker': '#4CAF50',    // Vert pour béton
        'granulats-marker': '#FF9800', // Orange pour granulats
        'ciment-marker': '#2196F3',   // Bleu pour ciment
        'ciment-prompt-marker': '#9C27B0' // Violet pour ciment prompt
    };
    
    // Fond
    ctx.fillStyle = colors[id] || '#666';
    ctx.beginPath();
    ctx.arc(size/2, size/2, size/2 - 3, 0, 2 * Math.PI);
    ctx.fill();
    
    // Bordure blanche
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Ajouter une lettre pour identifier le type
    const letters = {
        'beton-marker': 'B',
        'granulats-marker': 'G',
        'ciment-marker': 'C',
        'ciment-prompt-marker': 'P'
    };
    
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letters[id] || '?', size/2, size/2);
    
    const imageData = ctx.getImageData(0, 0, size, size);
    if (!map.hasImage(id)) {
        map.addImage(id, imageData);
    }
}

function createColoredMarkerForMapbox(id, color) {
    const size = 30;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Dessiner un cercle avec la couleur spécifiée
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size/2, size/2, size/2 - 3, 0, 2 * Math.PI);
    ctx.fill();
    
    // Bordure blanche
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    const imageData = ctx.getImageData(0, 0, size, size);
    if (!map.hasImage(id)) {
        map.addImage(id, imageData);
    }
}

function updateEstablishmentsSource(features) {
    if (map.getSource('establishments')) {
        const featureCollection = {
            type: 'FeatureCollection',
            features: features || establishmentsData.features
        };
        map.getSource('establishments').setData(featureCollection);
    }
}

function setupClusterInteractions() {
    console.log('Setting up cluster interactions');
    
    // NOUVELLE APPROCHE : Gestionnaire de clic global qui détecte manuellement les UP
    map.on('click', (e) => {
        // Détecter sur quoi on a cliqué
        const features = map.queryRenderedFeatures(e.point);
        
        // Chercher si on a cliqué sur une UP
        const upFeature = features.find(f => f.layer && f.layer.id === 'unclustered-point');
        
        if (upFeature) {
            console.log('Clic détecté sur UP via gestionnaire global:', upFeature.properties.UP);
            
            // On a cliqué sur une UP - afficher le popup persistant
            const coordinates = upFeature.geometry.coordinates.slice();
            const properties = upFeature.properties;
            
            // Fermer tous les popups existants
            if (clickedPopup) {
                closeClickedPopup();
            }
            if (hoverPopup) {
                hoverPopup.remove();
                hoverPopup = null;
                isHoveringPopup = false;
            }
            
            try {
                // Créer et afficher le popup persistant
                clickedPopup = createPopupContent(properties, coordinates, 'clicked');
                clickedPopup.setLngLat(coordinates).addTo(map);
                activePopups.push(clickedPopup);
                
                clickedPopup.on('close', () => {
                    const index = activePopups.indexOf(clickedPopup);
                    if (index > -1) {
                        activePopups.splice(index, 1);
                    }
                    clickedPopup = null;
                });
                
                console.log('Popup affiché avec succès');
            } catch (error) {
                console.error('Erreur:', error);
            }
            
            return; // Ne pas continuer pour fermer le popup
        }
        
        // Si on a cliqué sur un cluster
        const clusterFeature = features.find(f => f.layer && f.layer.id === 'clusters');
        if (clusterFeature) {
            // Zoom sur le cluster
            const clusterId = clusterFeature.properties.cluster_id;
            map.getSource('establishments').getClusterExpansionZoom(
                clusterId,
                (err, zoom) => {
                    if (err) return;
                    
                    const currentZoom = map.getZoom();
                    const newZoom = Math.min(zoom + 1, 22);
                    
                    map.easeTo({
                        center: clusterFeature.geometry.coordinates,
                        zoom: newZoom,
                        duration: 500
                    });
                }
            );
            return;
        }
        
        // Si on a cliqué sur la carte vide - fermer les popups
        console.log('Clic sur la carte vide');
        closeClickedPopup();
    });
    
    // Click event for clusters - progressive zoom (ANCIEN CODE - À GARDER AU CAS OÙ)
    map.on('click', 'clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, {
            layers: ['clusters']
        });
        
        const currentZoom = map.getZoom();
        const maxZoom = 16; // Limite de zoom maximum
        const zoomIncrement = 2; // Zoom progressif par étapes de 2
        
        // Calculer le nouveau niveau de zoom
        const newZoom = Math.min(currentZoom + zoomIncrement, maxZoom);
        
        // Zoomer vers le cluster de manière progressive
        map.easeTo({
            center: features[0].geometry.coordinates,
            zoom: newZoom,
            duration: 500
        });
    });

    // Variable pour détecter un double-clic
    let clickTimeout = null;
    
    // ANCIEN CODE DE CLIC - DÉSACTIVÉ CAR NE FONCTIONNE PAS
    // Le nouveau gestionnaire global gère maintenant les clics sur les UP
    /*
    map.on('click', 'unclustered-point', (e) => {
        console.log('Clic sur UP détecté');
        // ... ancien code ...
    });
    */
    
    // Double-click event for individual points
    map.on('dblclick', 'unclustered-point', (e) => {
        e.preventDefault();
        
        // Vérifier qu'il y a bien des features
        if (!e.features || !e.features[0]) return;
        
        // Annuler le timeout du simple clic si présent
        if (clickTimeout) {
            clearTimeout(clickTimeout);
            clickTimeout = null;
        }
        const feature = {
            geometry: e.features[0].geometry,
            properties: e.features[0].properties
        };
        
        // Comportement différent selon le mode
        if (window.currentAppMode === 'route') {
            // En mode itinéraire : remplir Point A ou Point B
            if (!currentSearchCenter) {
                // Si Point A est vide (pas de coordonnées), le remplir
                selectAsPointA(feature);
            } else if (!destinationCoords) {
                // Si Point A est rempli mais pas Point B (pas de destination), remplir Point B
                selectAsPointB(feature);
                // Le calcul d'itinéraire se lance automatiquement dans selectAsPointB
            } else {
                // Si les deux points sont remplis, remplacer le Point A et vider le Point B
                clearPointBSelection();
                selectAsPointA(feature);
            }
        } else {
            // En mode normal : sélectionner l'UP et afficher le rayon
            selectUPAndShowRadius(feature);
        }
    });

    // Change cursor to pointer when hovering over clusters or points
    map.on('mouseenter', 'clusters', () => {
        map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'clusters', () => {
        map.getCanvas().style.cursor = '';
    });
    
    // Variables pour la gestion optimisée du hover et des popups persistants
    let hoverPopup = null;
    let clickedPopup = null; // Popup persistant créé par clic
    let hoverTimeout = null;
    let closeTimeout = null;
    let currentHoverFeature = null;
    let isHoveringPopup = false;
    
    // Fonction pour fermer le popup cliqué
    function closeClickedPopup() {
        if (clickedPopup) {
            const index = activePopups.indexOf(clickedPopup);
            if (index > -1) {
                activePopups.splice(index, 1);
            }
            clickedPopup.remove();
            clickedPopup = null;
        }
    }
    
    // Fonction pour attacher les écouteurs au popup hover
    function attachHoverPopupListeners() {
        if (!hoverPopup || !hoverPopup._container) return;
        
        // Quand la souris entre dans le popup
        hoverPopup._container.addEventListener('mouseenter', () => {
            isHoveringPopup = true;
            // Annuler toute fermeture en cours
            if (closeTimeout) {
                clearTimeout(closeTimeout);
                closeTimeout = null;
            }
        });
        
        // Quand la souris quitte le popup
        hoverPopup._container.addEventListener('mouseleave', () => {
            isHoveringPopup = false;
            // Fermer après un délai si on n'est plus sur le point non plus
            closeTimeout = setTimeout(() => {
                if (!currentHoverFeature && !isHoveringPopup && hoverPopup) {
                    // Retirer de activePopups avant de supprimer
                    const index = activePopups.indexOf(hoverPopup);
                    if (index > -1) {
                        activePopups.splice(index, 1);
                    }
                    hoverPopup.remove();
                    hoverPopup = null;
                }
            }, 200); // Délai de grâce pour retourner au point
        });
    }
    
    map.on('mouseenter', 'unclustered-point', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        
        // Vérifier qu'il y a bien des features
        if (!e.features || !e.features[0]) return;
        
        // Stocker la feature actuelle pour vérification
        currentHoverFeature = e.features[0];
        const coordinates = e.features[0].geometry.coordinates.slice();
        
        // Vérifier s'il y a déjà un popup cliqué sur cette UP
        const hasClickedPopupOnSameUP = clickedPopup && (() => {
            const popupLngLat = clickedPopup.getLngLat();
            return Math.abs(popupLngLat.lng - coordinates[0]) < 0.0001 && 
                   Math.abs(popupLngLat.lat - coordinates[1]) < 0.0001;
        })();
        
        // Vérifier aussi s'il y a un popup dans activePopups sur cette UP (pour le popup de sélection)
        const hasActivePopupOnSameUP = activePopups.some(popup => {
            const popupLngLat = popup.getLngLat();
            return Math.abs(popupLngLat.lng - coordinates[0]) < 0.0001 && 
                   Math.abs(popupLngLat.lat - coordinates[1]) < 0.0001;
        });
        
        // Si un popup est déjà affiché sur cette UP, ne pas créer de tooltip hover
        if (hasClickedPopupOnSameUP || hasActivePopupOnSameUP) {
            return;
        }
        
        // Annuler tout timeout de fermeture
        if (closeTimeout) {
            clearTimeout(closeTimeout);
            closeTimeout = null;
        }
        
        // Fermer immédiatement l'ancien hover popup s'il existe et n'est pas sur la même UP
        if (hoverPopup) {
            const hoverLngLat = hoverPopup.getLngLat();
            if (Math.abs(hoverLngLat.lng - coordinates[0]) > 0.0001 || 
                Math.abs(hoverLngLat.lat - coordinates[1]) > 0.0001) {
                const index = activePopups.indexOf(hoverPopup);
                if (index > -1) {
                    activePopups.splice(index, 1);
                }
                hoverPopup.remove();
                hoverPopup = null;
                isHoveringPopup = false;
            }
        }
        
        // Créer et afficher le tooltip immédiatement (pas de délai)
        if (!hoverPopup) {
            // FERMER tout popup existant (cliqué ou hover)
            if (clickedPopup) {
                closeClickedPopup();
            }
            
            const properties = e.features[0].properties;
            
            // Créer le popup hover avec les bonnes options
            hoverPopup = createPopupContent(properties, coordinates, 'hover');
            
            // Afficher le popup avec animation fluide
            hoverPopup.setLngLat(coordinates).addTo(map);
            
            // Gérer la fermeture du hover popup avec la croix
            hoverPopup.on('close', () => {
                hoverPopup = null;
                isHoveringPopup = false;
            });
            
            // NE PAS ajouter le hover popup à activePopups pour éviter les conflits
            // activePopups.push(hoverPopup);
            
            // Attacher les écouteurs après un court délai pour s'assurer que le DOM est prêt
            setTimeout(attachHoverPopupListeners, 50);
        }
    });
    
    map.on('mouseleave', 'unclustered-point', () => {
        map.getCanvas().style.cursor = '';
        
        // Réinitialiser la feature actuelle
        currentHoverFeature = null;
        
        // Fermer uniquement si on n'est pas sur le popup
        if (hoverPopup && !isHoveringPopup) {
            closeTimeout = setTimeout(() => {
                if (!currentHoverFeature && !isHoveringPopup && hoverPopup) {
                    hoverPopup.remove();
                    hoverPopup = null;
                    isHoveringPopup = false;
                }
            }, 200); // Délai de grâce pour permettre de passer au popup
        }
    });
    
    // ANCIEN GESTIONNAIRE - DÉSACTIVÉ car maintenant intégré dans le gestionnaire global
    /*
    map.on('click', (e) => {
        setTimeout(() => {
            const features = map.queryRenderedFeatures(e.point, { layers: ['unclustered-point', 'clusters'] });
            if (features.length === 0) {
                console.log('Clic sur la carte vide - fermeture du popup');
                closeClickedPopup();
            }
        }, 10);
    });
    */
}


function updateLegendCountsFromViewport() {
    if (!map.isStyleLoaded() || !primaryFilteredFeatures) {
        return;
    }

    let featuresToCount = [];
    
    // Déterminer quels établissements compter selon le mode d'affichage
    if (currentLayoutMode === 'sidebarFull') {
        // En mode sidebar complet, compter tous les établissements filtrés
        featuresToCount = [...primaryFilteredFeatures];
    } else if (currentLayoutMode === 'mapFull' || currentLayoutMode === 'dual') {
        // En mode carte, compter seulement les établissements visibles dans le viewport
        if (currentSearchCenter && primaryFilteredFeatures.length > 0) {
            // Si recherche active, compter tous les résultats filtrés
            featuresToCount = [...primaryFilteredFeatures];
        } else {
            // Sinon, compter seulement ceux visibles sur la carte
            const mapBounds = map.getBounds();
            featuresToCount = primaryFilteredFeatures.filter(feature => {
                if (!feature.geometry || !feature.geometry.coordinates) return false;
                return mapBounds.contains(feature.geometry.coordinates);
            });
        }
    }

    // Compter par type d'activité
    const counts = { beton: 0, granulats: 0, ciment: 0, 'ciment-prompt': 0 };
    
    featuresToCount.forEach(feature => {
        const activity = feature.properties.activity;
        if (counts.hasOwnProperty(activity)) {
            counts[activity]++;
        }
    });

    // Mettre à jour les éléments de la légende
    const betonCountElement = document.getElementById('beton-count');
    const granulatsCountElement = document.getElementById('granulats-count');
    const cimentCountElement = document.getElementById('ciment-count');
    const cimentPromptCountElement = document.getElementById('ciment-prompt-count');
    
    if (betonCountElement) betonCountElement.textContent = counts.beton;
    if (granulatsCountElement) granulatsCountElement.textContent = counts.granulats;
    if (cimentCountElement) cimentCountElement.textContent = counts.ciment;
    if (cimentPromptCountElement) cimentPromptCountElement.textContent = counts['ciment-prompt'];
    
    // Afficher la légende ciment prompt seulement s'il y a des établissements ciment-prompt dans les données
    const cimentPromptLegend = document.getElementById('ciment-prompt-legend');
    if (cimentPromptLegend) {
        // Vérifier s'il y a au moins un établissement ciment-prompt dans TOUTES les données
        const hasCimentPrompt = establishmentsData.features.some(feature => 
            getActivityType(feature.properties.activity) === 'ciment-prompt'
        );
        
        if (hasCimentPrompt) {
            cimentPromptLegend.style.display = 'flex';
        } else {
            cimentPromptLegend.style.display = 'none';
        }
    }
    
    // Afficher la légende
    const mapLegend = document.getElementById('map-legend');
    if (mapLegend) {
        mapLegend.style.display = 'block';
    } else {
    }
}


function initializeMap() {
    // Préserver la légende et le switcher avant de nettoyer le conteneur
    const mapContainer = document.getElementById('map');
    let legendElement = null;
    let switcherElement = null;
    
    if (mapContainer) {
        // Sauvegarder la légende avant de nettoyer
        legendElement = mapContainer.querySelector('#map-legend');
        if (legendElement) {
            legendElement = legendElement.cloneNode(true);
        }
        
        // Sauvegarder le mode switcher avant de nettoyer
        switcherElement = mapContainer.querySelector('.mode-switcher-container');
        if (switcherElement) {
            switcherElement = switcherElement.cloneNode(true);
        }
        
        mapContainer.innerHTML = '';
    }
    
    map = new mapboxgl.Map({
        container: 'map', style: 'mapbox://styles/mapbox/streets-v11',
        center: [2.2137, 46.2276], zoom: 5, pitch: 0, bearing: 0,
        zoomControl: false, // Désactiver les contrôles de zoom par défaut (on utilise nos boutons custom)
        doubleClickZoom: false // Désactiver le zoom double-clic par défaut pour éviter les conflits
    });
    
    // Restaurer la légende et le switcher après l'initialisation de Mapbox
    if (switcherElement) {
        mapContainer.appendChild(switcherElement);
        // Réattacher les event listeners du switcher
        const modeNormalBtn = switcherElement.querySelector('#mode-normal');
        const modeRouteBtn = switcherElement.querySelector('#mode-route');
        if (modeNormalBtn && modeRouteBtn) {
            modeNormalBtn.addEventListener('click', () => switchMode('normal'));
            modeRouteBtn.addEventListener('click', () => switchMode('route'));
        }
    }
    if (legendElement) {
        mapContainer.appendChild(legendElement);
    }
    
    map.on('load', onMapLoad);
}

// Fonction pour ajouter les bâtiments 3D et monuments
function add3DBuildingsAndMonuments() {
    // Ajouter les bâtiments 3D
    const layers = map.getStyle().layers;
    const labelLayerId = layers.find(
        (layer) => layer.type === 'symbol' && layer.layout['text-field']
    ).id;

    // Ajouter la couche des bâtiments 3D
    map.addLayer({
        'id': '3d-buildings',
        'source': 'composite',
        'source-layer': 'building',
        'filter': ['==', 'extrude', 'true'],
        'type': 'fill-extrusion',
        'minzoom': 15,
        'paint': {
            'fill-extrusion-color': '#aaa',
            'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['zoom'],
                15,
                0,
                15.05,
                ['get', 'height']
            ],
            'fill-extrusion-base': [
                'interpolate',
                ['linear'],
                ['zoom'],
                15,
                0,
                15.05,
                ['get', 'min_height']
            ],
            'fill-extrusion-opacity': 0.6
        }
    }, labelLayerId);

    // Ajouter les monuments historiques (POI)
    map.addLayer({
        'id': 'monuments-3d',
        'source': 'composite',
        'source-layer': 'poi_label',
        'filter': [
            'all',
            ['==', ['get', 'class'], 'monument'],
            ['>=', ['zoom'], 16]
        ],
        'type': 'fill-extrusion',
        'paint': {
            'fill-extrusion-color': '#d4af37',
            'fill-extrusion-height': 20,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.8
        }
    }, labelLayerId);

    // Ajouter les symboles des monuments
    map.addLayer({
        'id': 'monuments-symbols',
        'type': 'symbol',
        'source': 'composite',
        'source-layer': 'poi_label',
        'filter': [
            'all',
            ['in', ['get', 'class'], ['literal', ['monument', 'landmark', 'place_of_worship']]]
        ],
        'minzoom': 14,
        'layout': {
            'icon-image': ['concat', ['get', 'maki'], '-15'],
            'icon-size': 1.2,
            'icon-allow-overlap': false,
            'text-field': ['get', 'name'],
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-offset': [0, 1.5],
            'text-anchor': 'top',
            'text-size': 12
        },
        'paint': {
            'icon-opacity': 0.9,
            'text-color': '#d4af37',
            'text-halo-color': '#fff',
            'text-halo-width': 2
        }
    });

}

function onMapLoad() {
    const loadingOverlay = document.getElementById('loading-overlay');
    loadingOverlay.style.opacity = '0';
    setTimeout(() => { loadingOverlay.style.display = 'none'; }, 500);
  
    if (typeof MapboxLanguage !== 'undefined') {
        const language = new MapboxLanguage({
            defaultLanguage: 'fr',
            excludedLayerIds: []
        });
        map.addControl(language);
        
        // Attendre que le style soit complètement chargé pour forcer le français
        map.on('styledata', () => {
            const layers = map.getStyle().layers;
            layers.forEach(layer => {
                if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
                    // Vérifier si le layer contient des labels de texte
                    if (layer.id.includes('label') || layer.id.includes('place')) {
                        try {
                            // Essayer de définir le champ de texte en français
                            const textField = ['coalesce',
                                ['get', 'name_fr'],
                                ['get', 'name:fr'],
                                ['get', 'name']
                            ];
                            map.setLayoutProperty(layer.id, 'text-field', textField);
                        } catch (e) {
                            // Ignorer les erreurs pour les layers qui ne supportent pas cette propriété
                        }
                    }
                }
            });
        });
    }
    map.addSource('mapbox-dem', { 'type': 'raster-dem', 'url': 'mapbox://mapbox.mapbox-terrain-dem-v1', 'tileSize': 512, 'maxzoom': 14 });
    map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
  
    // Ajouter les bâtiments 3D
    add3DBuildingsAndMonuments();
  
    // Add establishments source with clustering
    map.addSource('establishments', {
        type: 'geojson',
        data: establishmentsData,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 80,
        clusterMinPoints: 3  // Minimum 3 points pour former un cluster
    });
    
    // Load marker images first, then add layers
    loadMarkerImages(() => {
        addClusterLayers();
        setupClusterInteractions();
    });
  
    initializeGeocoder();
    initializeDirections();
    updateFilterOptions();
    setupEventListeners();
    initializeLayout();
    applyFilters();
    
    // Ajouter les événements pour mise à jour temps réel de la légende
    setupMapViewportListeners();
    
    // Attendre que la carte soit complètement chargée et rendue
    map.once('idle', () => {
        // Affichage initial des cartes et de la légende
        updateSidebarBasedOnMapViewport();
        updateLegendCountsFromViewport();
    });
    
    // Fallback au cas où 'idle' ne se déclenche pas
    setTimeout(() => {
        updateSidebarBasedOnMapViewport();
        updateLegendCountsFromViewport();
    }, 1000);
}

function setupMapViewportListeners() {
    // Créer une fonction debounced pour mettre à jour la sidebar ET la légende
    const debouncedViewportUpdate = debounce(() => {
        updateSidebarBasedOnMapViewport();
    }, 250); // Réduit légèrement le délai pour plus de réactivité
    
    // Écouter les mouvements de carte (pan)
    map.on('moveend', debouncedViewportUpdate);
    
    // Écouter les changements de zoom
    map.on('zoomend', debouncedViewportUpdate);
    
    // Écouter les changements de taille de fenêtre
    map.on('resize', debouncedViewportUpdate);
    
}

function initializeGeocoder() {
   geocoder = new MapboxGeocoder({
        accessToken: mapboxgl.accessToken, mapboxgl: mapboxgl,
        placeholder: 'Rechercher ville ou U.P.',
        countries: 'fr', localGeocoder: localUPGeocoder, localGeocoderOnly: false, language: 'fr'
   });
   document.getElementById('geocoder-container').appendChild(geocoder.onAdd(map));
   
   // Observer pour styliser les suggestions UP
   const observerConfig = { childList: true, subtree: true };
   const observerCallback = function(mutationsList) {
       for(let mutation of mutationsList) {
           if (mutation.addedNodes.length > 0) {
               // Chercher les suggestions contenant [UP]
               document.querySelectorAll('.mapboxgl-ctrl-geocoder--suggestion').forEach(suggestion => {
                   const title = suggestion.querySelector('.mapboxgl-ctrl-geocoder--suggestion-title');
                   if (title && title.textContent.includes('[UP]')) {
                       suggestion.classList.add('is-up');
                   }
               });
           }
       }
   };
   const observer = new MutationObserver(observerCallback);
   observer.observe(document.body, observerConfig);
   // Événement principal 'result'
   geocoder.on('result', (e) => {
        currentSearchCenter = e.result.center || e.result.geometry.coordinates;
        
        // Déterminer si c'est une UP ou une ville
        isPointAFromUP = !!(e.result.properties && (e.result.properties.UP || e.result.properties['Nom du site']));
        
        // Point A sélectionné - afficher automatiquement le Point B
        showRouteInterface();
        showPointB();
        
        // Changer automatiquement le focus vers B pour le prochain double-clic
        setFocusOnPointB();
        
        // Mettre à jour l'affichage
        if (isPointAFromUP) {
            updatePointADisplay(e.result.properties);
            // Stocker la feature pour Point A
            currentPointAFeature = e.result;
        } else {
            // Pour une adresse normale (ville), afficher dans le bandeau
            const selectedPointA = document.getElementById('selected-point-a');
            const pointAName = document.getElementById('point-a-name');
            const geocoderContainer = document.getElementById('geocoder-container');
            const clearPointA = document.getElementById('clear-point-a');
            
            if (selectedPointA && pointAName) {
                pointAName.textContent = e.result.place_name || e.result.text;
                selectedPointA.style.display = 'block';
                
                // Cacher le geocoder
                if (geocoderContainer) {
                    geocoderContainer.style.display = 'none';
                }
                
                // Ajouter l'event listener sur la croix
                if (clearPointA) {
                    clearPointA.addEventListener('click', clearPointASelection);
                }
            }
            // Stocker un objet feature même pour une ville
            currentPointAFeature = e.result;
        }
        
        // Afficher le contrôle de rayon et définir à 80 km
        showRadiusControl();
        
        // Définir le rayon à 80 km
        currentSearchRadius = 80;
        const radiusSlider = document.getElementById('radius-slider');
        if (radiusSlider) radiusSlider.value = 80;
        const radiusValue = document.getElementById('radius-value');
        if (radiusValue) radiusValue.textContent = "80 km";
        
        // Dessiner le cercle de 80 km autour du point sélectionné
        drawSearchRadiusCircle(currentSearchCenter, 80);
        
        // Appliquer les filtres avec le rayon de 80 km
        applyFilters();
        
        if (e.result.properties && e.result.properties.UP) {
            map.flyTo({ center: e.result.center, zoom: 14, pitch: 45, essential: true });
        }
   });
   
   // Créer le geocoder pour le Point B
   geocoderB = new MapboxGeocoder({
        accessToken: mapboxgl.accessToken, mapboxgl: mapboxgl,
        placeholder: 'Rechercher ville ou U.P.',
        countries: 'fr', localGeocoder: localUPGeocoder, localGeocoderOnly: false, language: 'fr'
   });
   document.getElementById('geocoder-container-b').appendChild(geocoderB.onAdd(map));
   // Événement 'result' pour Point B
   geocoderB.on('result', (e) => {
        const newDestinationCoords = e.result.center || e.result.geometry.coordinates;
        
        // Vérifier si les points ne sont pas identiques
        if (areCoordinatesIdentical(currentSearchCenter, newDestinationCoords)) {
            showIdenticalPointsWarning();
            geocoderB.clear();
            return;
        }
        
        // Déterminer si c'est une UP ou une ville
        isPointBFromUP = !!(e.result.properties && (e.result.properties.UP || e.result.properties['Nom du site']));
        
        destinationCoords = newDestinationCoords;
        // Mettre à jour l'affichage
        if (isPointBFromUP) {
            updatePointBDisplay(e.result.properties);
            // Stocker la feature pour Point B
            currentPointBFeature = e.result;
        } else {
            // Pour une adresse normale (ville)
            const selectedPointB = document.getElementById('selected-point-b');
            const pointBName = document.getElementById('point-b-name');
            const geocoderContainerB = document.getElementById('geocoder-container-b');
            const clearPointB = document.getElementById('clear-point-b');
            
            if (selectedPointB && pointBName) {
                pointBName.textContent = e.result.place_name || e.result.text;
                selectedPointB.style.display = 'block';
                
                // Cacher le geocoder B
                if (geocoderContainerB) {
                    geocoderContainerB.style.display = 'none';
                }
                
                // Ajouter l'event listener sur la croix
                if (clearPointB) {
                    clearPointB.addEventListener('click', clearPointBSelection);
                }
                
                const pointBSection = document.getElementById('point-b-section');
                if (pointBSection) {
                    pointBSection.style.borderColor = '#ffc107';
                    pointBSection.style.borderWidth = '2px';
                }
            }
            // Stocker un objet feature même pour une ville
            currentPointBFeature = e.result;
        }
        
        // Si A et B sont définis, vérifier qu'au moins un est une UP avant de calculer
        if (currentSearchCenter && destinationCoords) {
            if (!isPointAFromUP && !isPointBFromUP) {
                // Les deux sont des villes - afficher un message d'erreur
                showCityToCityError();
                return;
            }
            setTimeout(() => {
                showRouteOnMap(currentSearchCenter, destinationCoords);
            }, 500);
        } else {
        }
   });
   
   // Événements supplémentaires pour debug
   geocoder.on('loading', (e) => {
   });
   
   geocoder.on('results', (e) => {
   });
   
   geocoder.on('error', (e) => {
   });
   
   // Nouvel événement pour capturer les sélections (alternative)
   geocoder.on('response', (e) => {
   });
   
   geocoder.on('clear', () => {
        currentSearchCenter = null; 
        
        // Ne cacher l'interface de routage que si Point B n'est pas sélectionné
        if (!isPointBSelected()) {
            hideRouteInterface();
        }
        
        // Cacher le contrôle de rayon quand on efface la recherche
        hideRadiusControl();
        removeSearchRadiusCircle(); 
        applyFilters();
   });
   
   // Surveillance DOM en fallback pour capturer les clics sur les suggestions
   setupGeocoderDOMWatcher();
}

function setupGeocoderDOMWatcher() {
    // Surveiller les changements dans le container du geocoder
    setTimeout(() => {
        const geocoderContainer = document.querySelector('.mapboxgl-ctrl-geocoder');
        if (geocoderContainer) {
            // Surveiller les clics sur les suggestions
            geocoderContainer.addEventListener('click', (e) => {
                // Vérifier si c'est un clic sur une suggestion
                const suggestion = e.target.closest('.mapboxgl-ctrl-geocoder--suggestion');
                if (suggestion) {
                    // Attendre un peu pour que le geocoder traite le clic
                    setTimeout(() => {
                        const inputValue = geocoderContainer.querySelector('.mapboxgl-ctrl-geocoder--input').value;
                        // Si l'input contient quelque chose qui ressemble à une UP, déclencher showRadiusControl
                        if (inputValue && inputValue.includes(',')) {
                            // Essayer de trouver les coordonnées depuis les données
                            const matchingUP = establishmentsData.features.find(f => 
                                f.properties.UP && inputValue.includes(f.properties.UP)
                            );
                            if (matchingUP) {
                                currentSearchCenter = matchingUP.geometry.coordinates;
                                showRadiusControl();
                                applyFilters();
                            }
                        }
                    }, 100);
                }
            });
        } else {
            setTimeout(setupGeocoderDOMWatcher, 1000);
        }
    }, 500);
}

function initializeDirections() {
    // Initialiser le service Mapbox Directions
    directions = new MapboxDirections({
        accessToken: mapboxgl.accessToken,
        unit: 'metric',
        profile: 'mapbox/driving',
        controls: {
            inputs: false,
            instructions: false,
            profileSwitcher: false
        },
        interactive: false,
        flyTo: false // Empêcher le zoom automatique
    });
    
    // Ajouter le contrôle à la carte
    map.addControl(directions, 'top-right');
    // Masquer seulement l'interface utilisateur, pas les routes
    setTimeout(() => {
        const directionsControl = document.querySelector('.mapbox-directions-component');
        if (directionsControl) {
            // Masquer seulement les inputs et contrôles, pas les routes
            const inputs = directionsControl.querySelector('.mapbox-directions-instructions');
            const inputContainer = directionsControl.querySelector('.mapbox-directions-inputs');
            
            if (inputs) inputs.style.display = 'none';
            if (inputContainer) inputContainer.style.display = 'none';
            
        }
    }, 100);
}

function showRouteOnMap(originCoords, destinationCoords) {
    if (!originCoords || !destinationCoords) {
        return;
    }
    
    // Vérifier que les coordonnées sont valides
    if (!Array.isArray(originCoords) || !Array.isArray(destinationCoords)) {
        return;
    }
    
    // Nettoyer la route précédente
    clearCurrentRoute();
    
    // Approche alternative : utiliser directement l'API Directions
    showRouteWithDirectAPI(originCoords, destinationCoords);
}

async function showRouteWithDirectAPI(originCoords, destinationCoords) {
    const loader = showRouteLoader();
    
    try {
        // Récupérer les options sélectionnées depuis les boutons ULTRATHINK
        const vehicleType = currentVehicleType;
        const tollOption = currentTollOption;
        const optimizeOption = 'time'; // Toujours optimiser pour le temps
        
        // Vérifier le cache d'abord
        const options = { vehicleType, tollOption, optimizeOption };
        const cacheKey = generateCacheKey(originCoords, destinationCoords, options);
        const cachedData = getCachedRoute(cacheKey);
        
        if (cachedData) {
            hideRouteLoader();
            processRouteData(cachedData);
            return;
        }
        
        // Validation des coordonnées
        if (!originCoords || !destinationCoords || originCoords.length !== 2 || destinationCoords.length !== 2) {
            throw new Error('Coordonnées invalides pour le calcul d\'itinéraire');
        }
        
        // Construire l'URL de l'API Directions avec les options avancées
        const coordinates = `${originCoords[0]},${originCoords[1]};${destinationCoords[0]},${destinationCoords[1]}`;
        
        // Profil de routage selon le véhicule
        let profile = 'driving';
        if (vehicleType === 'driving-traffic') {
            profile = 'driving-traffic'; // Pour les poids lourds avec info trafic
        }
        
        // Construction des paramètres de l'URL
        let urlParams = new URLSearchParams({
            geometries: 'geojson',
            overview: 'full',
            steps: 'true',
            voice_instructions: 'true',
            annotations: 'duration,distance,speed',
            language: 'fr',
            access_token: mapboxgl.accessToken
        });
        
        // Ajouter l'évitement des péages si sélectionné
        if (tollOption === 'avoid') {
            urlParams.append('exclude', 'toll');
        }
        
        // Ajouter l'optimisation
        if (optimizeOption === 'distance') {
            urlParams.append('annotations', 'duration,distance');
        }
        
        const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinates}?${urlParams}`;
        
        // Timeout pour l'API (réduit à 10 secondes)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`Erreur API: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Vérifier si la réponse contient des erreurs
        if (data.code && data.code !== 'Ok') {
            throw new Error(`API Error: ${data.code} - ${data.message || 'Erreur inconnue'}`);
        }
        
        // Mettre en cache pour les requêtes futures
        cacheRoute(cacheKey, data);
        
        hideRouteLoader();
        processRouteData(data);
        
    } catch (error) {
        hideRouteLoader();
        // Fallback : essayer avec l'API simple
        try {
            const fallbackUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?geometries=geojson&overview=full&steps=true&access_token=${mapboxgl.accessToken}`;
            
            const fallbackResponse = await fetch(fallbackUrl);
            const fallbackData = await fallbackResponse.json();
            
            if (fallbackData.routes && fallbackData.routes[0]) {
                processRouteData(fallbackData);
                return;
            }
        } catch (fallbackError) {
        }
        
        // Si les deux échouent, afficher l'erreur
        let errorMessage = 'Impossible de calculer l\'itinéraire. Veuillez réessayer.';
        
        if (error.name === 'AbortError') {
            errorMessage = 'Le calcul d\'itinéraire a pris trop de temps. Essai en cours avec options simplifiées...';
        } else if (error.message.includes('Erreur API')) {
            errorMessage = 'Service d\'itinéraire temporairement indisponible. Veuillez réessayer dans quelques minutes.';
        } else if (error.message.includes('Coordonnées invalides')) {
            errorMessage = 'Les points sélectionnés ne sont pas valides. Veuillez sélectionner d\'autres emplacements.';
        }
        
        showRouteError(errorMessage);
    }
}

// Fonction factorisant le traitement des données de routage
function processRouteData(data) {
    if (!data.routes || !data.routes[0]) {
        showRouteError('Aucun itinéraire trouvé entre ces deux points. Essayez avec d\'autres destinations.');
        return;
    }
    
    const route = data.routes[0];
    
    // Validation des données de route
    if (!route.geometry || !route.geometry.coordinates || route.geometry.coordinates.length === 0) {
        showRouteError('Données d\'itinéraire invalides reçues du service.');
        return;
    }
    
    // Ajouter la route à la carte comme source et layer
    addRouteToMap(route);
    
    // Centrer la carte sur l'itinéraire en tenant compte de la zone visible
    try {
        // Créer les bounds incluant tous les points de l'itinéraire
        const bounds = new mapboxgl.LngLatBounds();
        
        // Inclure les points A et B en priorité
        if (currentSearchCenter) bounds.extend(currentSearchCenter);
        if (destinationCoords) bounds.extend(destinationCoords);
        
        // Inclure quelques points clés de la route pour un meilleur ajustement
        if (route.geometry && route.geometry.coordinates) {
            const coords = route.geometry.coordinates;
            const step = Math.max(1, Math.floor(coords.length / 10)); // Échantillonner 10 points
            for (let i = 0; i < coords.length; i += step) {
                bounds.extend(coords[i]);
            }
        }
        
        // Définir le padding en fonction du layout
        let paddingOptions;
        
        if (currentLayoutMode === 'dual') {
            // En mode dual, compenser pour la sidebar en ajoutant du padding à gauche
            const sidebar = document.getElementById('sidebar');
            const sidebarWidth = sidebar ? sidebar.offsetWidth : 415;
            
            paddingOptions = {
                top: 100,
                bottom: 100,
                left: sidebarWidth + 80, // Sidebar + marge
                right: 80
            };
        } else {
            // En mode plein écran, padding symétrique
            paddingOptions = {
                top: 100,
                bottom: 100,
                left: 100,
                right: 100
            };
        }
        
        // Ajuster la vue avec fitBounds qui gérera automatiquement le centrage
        map.fitBounds(bounds, {
            padding: paddingOptions,
            duration: 1500,
            maxZoom: 15, // Limiter le zoom pour garder une vue d'ensemble
            linear: false,
            essential: true
        });
    } catch (error) {
        console.error('Erreur lors du centrage de la carte:', error);
    }
    
    // Mettre à jour les temps de trajet avec les données réelles
    if (typeof updateTravelTimesWithRealData === 'function') {
        updateTravelTimesWithRealData(route);
    }
    
    // Mettre à jour le résumé et afficher le panneau
    updateRouteSummary(data);
    showRouteDetails();
    
    // Ajouter le bouton pour nettoyer le trajet
    if (typeof addRouteClearButton === 'function') {
        addRouteClearButton();
    }
    
}

// Cache pour les itinéraires
const routeCache = new Map();
const CACHE_EXPIRY = 30 * 60 * 1000; // 30 minutes

// Fonction pour générer une clé de cache
function generateCacheKey(originCoords, destinationCoords, options) {
    const { vehicleType, tollOption, optimizeOption } = options;
    return `${originCoords.join(',')}-${destinationCoords.join(',')}-${vehicleType}-${tollOption}-${optimizeOption}`;
}

// Fonction pour vérifier le cache
function getCachedRoute(cacheKey) {
    const cached = routeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY) {
        return cached.data;
    }
    if (cached) {
        routeCache.delete(cacheKey); // Supprimer l'entrée expirée
    }
    return null;
}

// Fonction pour mettre en cache un itinéraire
function cacheRoute(cacheKey, data) {
    routeCache.set(cacheKey, {
        data: data,
        timestamp: Date.now()
    });
}

// Fonction pour afficher les erreurs de routage
function showRouteError(message) {
    const errorContainer = document.createElement('div');
    errorContainer.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #dc3545, #c82333);
        color: white;
        padding: 20px 30px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(220, 53, 69, 0.3);
        z-index: 18;
        font-family: Arial, sans-serif;
        text-align: center;
        max-width: 400px;
        border: 2px solid rgba(255, 255, 255, 0.2);
    `;
    
    // Créer les éléments sans innerHTML pour éviter les problèmes d'iframe
    const errorIcon = document.createElement('div');
    errorIcon.style.fontSize = '24px';
    errorIcon.style.marginBottom = '10px';
    errorIcon.textContent = '[!]';
    
    const errorTitle = document.createElement('div');
    errorTitle.style.fontWeight = 'bold';
    errorTitle.style.marginBottom = '10px';
    errorTitle.textContent = 'Erreur de calcul d\'itin\u00E9raire';
    
    const errorMessage = document.createElement('div');
    errorMessage.style.marginBottom = '15px';
    errorMessage.style.lineHeight = '1.4';
    errorMessage.textContent = message;
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Fermer';
    closeButton.style.cssText = 'background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.3); color: white; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;';
    closeButton.onclick = () => errorContainer.remove();
    
    errorContainer.appendChild(errorIcon);
    errorContainer.appendChild(errorTitle);
    errorContainer.appendChild(errorMessage);
    errorContainer.appendChild(closeButton);
    
    document.body.appendChild(errorContainer);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (errorContainer && errorContainer.parentElement) {
            errorContainer.remove();
        }
    }, 5000);
}

// Fonction pour afficher le loader
function showRouteLoader() {
    const loader = document.createElement('div');
    loader.id = 'route-loader';
    loader.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        padding: 30px;
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
        z-index: 17;
        text-align: center;
        font-family: Arial, sans-serif;
        border: 1px solid rgba(0, 32, 96, 0.1);
    `;
    
    // Ajouter l'animation CSS si elle n'existe pas déjà
    if (!document.getElementById('spin-animation-style')) {
        const styleElement = document.createElement('style');
        styleElement.id = 'spin-animation-style';
        styleElement.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
        document.head.appendChild(styleElement);
    }
    
    // Créer les éléments du loader
    const spinner = document.createElement('div');
    spinner.style.cssText = 'width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #002060; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 15px auto;';
    
    const mainText = document.createElement('div');
    mainText.style.cssText = 'color: #002060; font-weight: bold; font-size: 16px;';
    mainText.textContent = 'Calcul de l\'itin\u00E9raire en cours...';
    
    const subText = document.createElement('div');
    subText.style.cssText = 'color: #666; font-size: 12px; margin-top: 5px;';
    subText.textContent = 'Veuillez patienter';
    
    loader.appendChild(spinner);
    loader.appendChild(mainText);
    loader.appendChild(subText);
    
    document.body.appendChild(loader);
    return loader;
}

// Fonction pour masquer le loader
function hideRouteLoader() {
    const loader = document.getElementById('route-loader');
    if (loader) {
        loader.remove();
    }
}

// Fonction de nettoyage du cache (appelée périodiquement)
function cleanupCache() {
    const now = Date.now();
    for (const [key, value] of routeCache.entries()) {
        if (now - value.timestamp > CACHE_EXPIRY) {
            routeCache.delete(key);
        }
    }
}

// Nettoyer le cache toutes les 10 minutes
setInterval(cleanupCache, 10 * 60 * 1000);

// Fonction de validation des inputs utilisateur
function validateRouteInputs() {
    const errors = [];
    
    if (!currentSearchCenter) {
        errors.push('Veuillez sélectionner un point de départ');
    }
    
    if (!destinationCoords) {
        errors.push('Veuillez sélectionner une destination');
    }
    
    if (currentSearchCenter && destinationCoords) {
        const distance = calculateDistance(currentSearchCenter, destinationCoords);
        if (distance < 0.1) { // Moins de 100m
            errors.push('Les points de départ et d\'arrivée sont trop proches');
        }
        if (distance > 1000) { // Plus de 1000km
            errors.push('La distance entre les points est trop importante');
        }
    }
    
    return errors;
}

// Fonction pour calculer la distance entre deux points (en km)
function calculateDistance(coord1, coord2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(coord1[1] * Math.PI / 180) * Math.cos(coord2[1] * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Fonction d'optimisation des performances
function optimizePerformance() {
    // Désactiver les animations sur les appareils avec peu de mémoire
    if (navigator.deviceMemory && navigator.deviceMemory < 4) {
        document.documentElement.style.setProperty('--animation-duration', '0.1s');
    }
    
    // Réduire la complexité visuelle sur mobile
    if (window.innerWidth < 768) {
        const routeInstructions = document.querySelectorAll('.route-instruction-item');
        routeInstructions.forEach(item => {
            item.style.transition = 'none';
        });
    }
    
    // Nettoyer les event listeners inutiles
    window.addEventListener('beforeunload', () => {
        if (window.routeAnimation) {
            clearInterval(window.routeAnimation);
        }
        routeCache.clear();
    });
}

// Initialiser les optimisations au chargement
document.addEventListener('DOMContentLoaded', optimizePerformance);

function addRouteToMap(route) {
    // Supprimer la source existante si elle existe
    if (map.getSource('route')) {
        map.removeLayer('route');
        map.removeSource('route');
    }
    
    // Ajouter la nouvelle route
    map.addSource('route', {
        'type': 'geojson',
        'data': {
            'type': 'Feature',
            'properties': {},
            'geometry': route.geometry
        }
    });
    
    map.addLayer({
        'id': 'route',
        'type': 'line',
        'source': 'route',
        'layout': {
            'line-join': 'round',
            'line-cap': 'round'
        },
        'paint': {
            'line-color': '#3887be',
            'line-width': 5,
            'line-opacity': 0.75
        }
    });
    
    // Mettre à jour la taille des pins sélectionnés
    updateSelectedPointsSize();
    
    currentRouteSource = 'route';
    isRouteMode = true; // Activer le mode itinéraire
    
    // Masquer rayon et légende quand itinéraire affiché
    hideRadiusControl();
    hideLegend();
    
    // Supprimer le cercle de rayon de la carte
    removeSearchRadiusCircle();
    
    // Centrer la carte sur l'itinéraire avec fit bounds
    fitMapToRoute(route);
    
    // Afficher info route sur la carte
    showRouteInfoOnMap(route);
}

// Fonction pour mettre à jour la taille des pins sélectionnés
function updateSelectedPointsSize() {
    if (!map.getLayer('unclustered-point')) return;
    
    // Créer une expression pour déterminer la taille des icons
    let sizeExpression = ['case'];
    
    // Si Point A est sélectionné
    if (currentPointAFeature && currentSearchCenter) {
        // Utiliser le nom de l'établissement pour identifier le point
        const pointAName = currentPointAFeature.properties?.UP || currentPointAFeature.properties?.['Nom du site'];
        if (pointAName) {
            sizeExpression.push(
                ['==', ['get', 'UP'], pointAName],
                1.5  // Taille augmentée de 50%
            );
        }
    }
    
    // Si Point B est sélectionné
    if (currentPointBFeature && destinationCoords) {
        // Utiliser le nom de l'établissement pour identifier le point
        const pointBName = currentPointBFeature.properties?.UP || currentPointBFeature.properties?.['Nom du site'];
        if (pointBName) {
            sizeExpression.push(
                ['==', ['get', 'UP'], pointBName],
                1.5  // Taille augmentée de 50%
            );
        }
    }
    
    // Taille par défaut
    sizeExpression.push(1.0);
    
    // Appliquer la nouvelle taille
    map.setLayoutProperty('unclustered-point', 'icon-size', sizeExpression);
}

// Fonctions pour contrôler la légende
function hideLegend() {
    const mapLegend = document.getElementById('map-legend');
    if (mapLegend) {
        mapLegend.style.display = 'none';
    }
}

function showLegend() {
    const mapLegend = document.getElementById('map-legend');
    if (mapLegend) {
        mapLegend.style.display = 'block';
    }
}

// Fonction pour centrer la carte sur l'itinéraire avec zoom optimal sur les deux points
function fitMapToRoute(route) {
    try {
        const coordinates = route.geometry.coordinates;
        const startPoint = coordinates[0];
        const endPoint = coordinates[coordinates.length - 1];
        const distance = route.distance / 1000; // distance en km
        
        // Créer bounds uniquement avec les points de départ et d'arrivée pour zoom maximum
        const bounds = new mapboxgl.LngLatBounds()
            .extend(startPoint)
            .extend(endPoint);
        
        let maxZoom;
        let padding;
        
        // Zoom plus agressif avec padding minimal pour voir les deux points au maximum
        if (distance < 2) {
            maxZoom = 18;  // Très proche - zoom ultra-max
            padding = 10;
        } else if (distance < 5) {
            maxZoom = 17;  // Très proche - zoom très élevé
            padding = 15;
        } else if (distance < 15) {
            maxZoom = 15;  // Distance courte - zoom élevé
            padding = 20;
        } else if (distance < 40) {
            maxZoom = 13;  // Distance moyenne - zoom modéré-élevé
            padding = 25;
        } else if (distance < 100) {
            maxZoom = 11;  // Distance longue - zoom modéré
            padding = 30;
        } else {
            maxZoom = 9;   // Très longue distance - zoom large
            padding = 40;
        }
        
        map.fitBounds(bounds, {
            padding: padding,
            maxZoom: maxZoom,
            duration: 1500,
            essential: true // Force l'animation même si l'utilisateur interagit
        });
        
    } catch (error) {
    }
}

// Fonction pour afficher les infos de l'itinéraire sur la carte
function showRouteInfoOnMap(route) {
    // Supprimer l'info précédente si elle existe
    hideRouteInfoOnMap();
    
    const distance = (route.distance / 1000).toFixed(1);
    const durationHours = Math.floor(route.duration / 3600);
    const durationMinutes = Math.floor((route.duration % 3600) / 60);
    const durationText = durationHours > 0 ? `${durationHours}h ${durationMinutes}min` : `${durationMinutes}min`;
    
    const routeInfo = document.createElement('div');
    routeInfo.id = 'route-info-overlay';
    routeInfo.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        background: rgba(0, 32, 96, 0.9);
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: bold;
        z-index: 11;
        animation: slideInFromRight 0.5s ease-out;
    `;
    
    // Créer les éléments sans innerHTML pour éviter les problèmes d'iframe
    const infoContainer = document.createElement('div');
    infoContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';
    
    const pinSpan = document.createElement('span');
    pinSpan.textContent = '[PIN]';
    
    const distanceSpan = document.createElement('span');
    distanceSpan.textContent = distance + ' km • ' + durationText;
    
    infoContainer.appendChild(pinSpan);
    infoContainer.appendChild(distanceSpan);
    routeInfo.appendChild(infoContainer);
    
    // Ajouter à la carte
    document.getElementById('map').appendChild(routeInfo);
}

// Fonction pour masquer les infos de l'itinéraire sur la carte
function hideRouteInfoOnMap() {
    const routeInfo = document.getElementById('route-info-overlay');
    if (routeInfo) {
        routeInfo.remove();
    }
}

function clearCurrentRoute() {
    // Réinitialiser les données réelles de routage
    realRouteData = null;
    
    // Nettoyer la route du plugin Directions
    if (directions) {
        directions.removeRoutes();
    }
    
    // Nettoyer la route ajoutée manuellement
    if (currentRouteSource === 'route' && map.getSource('route')) {
        map.removeLayer('route');
        map.removeSource('route');
    }
    
    // Réinitialiser la taille des pins
    if (map.getLayer('unclustered-point')) {
        map.setLayoutProperty('unclustered-point', 'icon-size', 1.0);
    }
    
    // Supprimer le marker de destination et nettoyer l'interface
    removeDestinationMarker();
    
    // Supprimer le bouton de nettoyage fixe s'il existe
    const clearBtn = document.getElementById('clear-route-btn');
    if (clearBtn) {
        clearBtn.remove();
    }
    
    currentRouteSource = null;
    isRouteMode = false; // Désactiver le mode itinéraire
    
    // Réactiver la légende et le rayon quand itinéraire supprimé
    showLegend();
    if (currentSearchCenter) {
        showRadiusControl();
        // Redessiner le cercle de rayon avec la valeur courante
        drawSearchRadiusCircle(currentSearchCenter, currentSearchRadius);
    }
    
    // Masquer les infos de route de la carte
    hideRouteInfoOnMap();
    
    // Rafraîchir les popups actifs pour mettre à jour les boutons
    activePopups.forEach(popup => {
        try {
            const lngLat = popup.getLngLat();
            const popupElement = popup.getElement();
            if (popupElement && establishmentsData && establishmentsData.features) {
                // Trouver les propriétés de l'établissement basé sur les coordonnées
                const feature = establishmentsData.features.find(f => 
                    Math.abs(f.geometry.coordinates[0] - lngLat.lng) < 0.0001 &&
                    Math.abs(f.geometry.coordinates[1] - lngLat.lat) < 0.0001
                );
                if (feature) {
                    const newPopup = createPopupContent(feature.properties, [lngLat.lng, lngLat.lat]);
                    const newPopupElement = newPopup.getElement();
                    if (newPopupElement && newPopupElement.firstChild) {
                        popup.setDOMContent(newPopupElement.firstChild);
                    }
                }
            }
        } catch (error) {
        }
    });
    
    // Rafraîchir la barre latérale pour mettre à jour les boutons
    updateSidebarBasedOnMapViewport();
    
}

function updateTravelTimesWithRealData(route) {
    // Vérifier que la route contient les données attendues
    if (!route || typeof route.duration === 'undefined' || typeof route.distance === 'undefined') {
        return;
    }
    
    // Extraire la durée réelle du trajet depuis l'API (en secondes)
    const realDurationSeconds = route.duration;
    const realDistanceMeters = route.distance;
    
    // Convertir en format lisible
    const realTravelTime = formatDuration(realDurationSeconds);
    const realDistance = (realDistanceMeters / 1000).toFixed(1); // convertir en km
    
    // Stocker les données réelles pour une utilisation dans les popups
    realRouteData = {
        distance: realDistance,
        travelTime: realTravelTime,
        distanceMeters: realDistanceMeters,
        durationSeconds: realDurationSeconds
    };
    
    // Mettre à jour les badges existants avec les données réelles
    const distanceBadges = document.querySelectorAll('.distance-badge');
    if (distanceBadges) {
        distanceBadges.forEach(badge => {
            if (badge && badge.textContent && badge.textContent.includes(' km')) {
                badge.textContent = `${realDistance} km`;
            }
        });
    }
    
    const timeBadges = document.querySelectorAll('.time-badge');
    if (timeBadges) {
        timeBadges.forEach(badge => {
            if (badge) {
                badge.textContent = realTravelTime;
            }
        });
    }
    
    // Rafraîchir la sidebar pour utiliser les nouvelles données réelles
    applyFilters();
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}min`;
    } else {
        return `${minutes} min`;
    }
}

function addRouteClearButton() {
    // Cette fonction ne crée plus de bouton fixe car les boutons sont maintenant intégrés 
    // dans les popups et les cartes de la barre latérale
    // Supprimer le bouton fixe existant s'il existe
    const existingBtn = document.getElementById('clear-route-btn');
    if (existingBtn) {
        existingBtn.remove();
    }
}

function updateFilterOptions() {
    const activityOptions = new Set();
    establishmentsData.features.forEach(feature => {
        if (feature.properties.activity) activityOptions.add(feature.properties.activity);
    });
}

function setupEventListeners() {
    // Les event listeners du contrôle de rayon seront ajoutés dynamiquement
    // quand le contrôle devient visible

    document.getElementById('geolocate').addEventListener('click', () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(position => {
                currentSearchCenter = [position.coords.longitude, position.coords.latitude];
                if (geocoder) geocoder.setInput('Ma position actuelle');
                
                // Afficher le contrôle de rayon et définir à 80 km
                showRadiusControl();
                currentSearchRadius = 80;
                const radiusSlider = document.getElementById('radius-slider');
                if (radiusSlider) radiusSlider.value = 80;
                const radiusValue = document.getElementById('radius-value');
                if (radiusValue) radiusValue.textContent = "80 km";
                
                // Dessiner le cercle de 80 km
                drawSearchRadiusCircle(currentSearchCenter, 80);
                
                // Zoomer pour voir tout le rayon
                map.flyTo({ center: currentSearchCenter, zoom: 9.5, duration: 1500 });
                
                showRouteInterface();
                applyFilters();
            }, () => { alert("Impossible d'accéder à votre position."); });
        } else { alert("La géolocalisation n'est pas supportée par votre navigateur."); }
    });

    document.getElementById('reset-map').addEventListener('click', resetMap);
    
    // Ajouter l'event listener pour le bouton de réinitialisation inline
    const resetMapInline = document.getElementById('reset-map-inline');
    if (resetMapInline) {
        resetMapInline.addEventListener('click', resetMap);
    }
    
    // Ajouter l'event listener pour le bouton de réinitialisation du mode route
    const resetMapRoute = document.getElementById('reset-map-route');
    if (resetMapRoute) {
        resetMapRoute.addEventListener('click', () => {
            resetMap();
            // Revenir au mode normal après réinitialisation
            if (window.switchToNormalMode) {
                window.switchToNormalMode();
            }
        });
    }
    
    // Initialiser les event listeners de la légende interactive
    initializeLegendListeners();
    
    // Initialiser les event listeners de l'interface d'itinéraire
    initializeRouteInterface();
    
    // Initialiser les contrôles de zoom personnalisés
    initializeCustomZoomControls();
    
    
    const modal = document.getElementById('modal');
    window.addEventListener('resize', debounce(checkAndSetLayout, 300));
}

// Fonction pour initialiser les contrôles de zoom personnalisés
function initializeCustomZoomControls() {
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    
    if (zoomInBtn && zoomOutBtn) {
        zoomInBtn.addEventListener('click', () => {
            if (map) {
                map.zoomIn();
            }
        });
        
        zoomOutBtn.addEventListener('click', () => {
            if (map) {
                map.zoomOut();
            }
        });
        
    } else {
    }
}

// Fonction pour initialiser les événements de clic sur la légende
function initializeLegendListeners() {
    // Gérer le toggle du titre de la légende
    const legendTitle = document.querySelector('.map-legend h4');
    if (legendTitle) {
        legendTitle.addEventListener('click', () => {
            const legend = document.querySelector('.map-legend');
            legend.classList.toggle('collapsed');
            
            // Mettre à jour la position immédiatement pour une transition fluide
            updateRadiusControlPosition();
            
            // Recalculer après l'animation pour s'assurer de la position finale
            setTimeout(() => {
                updateRadiusControlPosition();
            }, 300);
        });
    }
    
    const legendItems = document.querySelectorAll('.legend-item');
    
    legendItems.forEach(item => {
        // Extraire le type d'activité du marker
        const marker = item.querySelector('.legend-marker');
        const activityType = marker.className.split(' ').find(cls => 
            cls === 'beton' || cls === 'granulats' || cls === 'ciment' || cls === 'ciment-prompt'
        );
        
        if (activityType) {
            item.addEventListener('click', () => {
                toggleActivityFilter(activityType);
            });
            
            // Ajouter l'attribut pour l'accessibilité
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');
            item.setAttribute('aria-pressed', 'true');
            
            // Support clavier
            item.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleActivityFilter(activityType);
                }
            });
        }
    });
}

// Fonction pour basculer un filtre d'activité
function toggleActivityFilter(activityType) {
    // Si aucun filtre actif, on affiche tout
    // Si on clique sur une catégorie :
    //   - Si elle est la seule active, on la désactive (= afficher tout)
    //   - Si elle n'est pas active, on l'active
    //   - Si elle est active parmi d'autres, on la désactive
    
    if (activeFilters.size === 0) {
        // Aucun filtre actif = tout est affiché
        // On active seulement cette catégorie
        activeFilters.add(activityType);
    } else if (activeFilters.has(activityType)) {
        // Cette catégorie est active, on la désactive
        activeFilters.delete(activityType);
    } else {
        // Cette catégorie n'est pas active, on l'active
        activeFilters.add(activityType);
    }
    
    updateLegendVisualState();
    applyFilters();
}

// Fonction pour mettre à jour l'état visuel de la légende
function updateLegendVisualState() {
    const legendItems = document.querySelectorAll('.legend-item');
    
    legendItems.forEach(item => {
        const marker = item.querySelector('.legend-marker');
        const activityType = marker.className.split(' ').find(cls => 
            cls === 'beton' || cls === 'granulats' || cls === 'ciment' || cls === 'ciment-prompt'
        );
        
        if (activityType) {
            // Si aucun filtre actif, aucun item n'est marqué comme actif visuellement
            // Sinon, on marque comme inactif ceux qui ne sont pas dans activeFilters
            const isActive = activeFilters.size === 0 ? false : activeFilters.has(activityType);
            item.classList.toggle('inactive', activeFilters.size > 0 && !isActive);
            item.setAttribute('aria-pressed', isActive.toString());
        }
    });
}

// Fonctions pour l'interface d'itinéraire améliorée
function showRouteInterface() {
    // Ne plus afficher automatiquement le Point B - seulement s'assurer que le Point A est visible
    // Le Point A est toujours visible maintenant
}

function showPointB() {
    const pointBSection = document.getElementById('point-b-section');
    const addBtn = document.getElementById('add-destination-btn');
    if (pointBSection && addBtn) {
        pointBSection.style.display = 'block';
        addBtn.textContent = '-';
        addBtn.title = 'Masquer la destination';
    }
}

function hidePointB() {
    const pointBSection = document.getElementById('point-b-section');
    const addBtn = document.getElementById('add-destination-btn');
    if (pointBSection && addBtn) {
        pointBSection.style.display = 'none';
        addBtn.textContent = '+';
        addBtn.title = 'Ajouter une destination';
        // Reset destination data
        destinationCoords = null;
        clearPointBDisplay();
        // Réinitialiser le geocoder B
        if (geocoderB) {
            geocoderB.clear();
        }
        removeDestinationMarker();
    }
}

function togglePointB() {
    const pointBSection = document.getElementById('point-b-section');
    if (pointBSection) {
        if (pointBSection.style.display === 'none' || pointBSection.style.display === '') {
            showPointB();
        } else {
            hidePointB();
            // Clear route if it exists
            clearRoute();
        }
    }
}

function hideRouteInterface() {
    // Reset everything to initial state
    hidePointB();
    destinationCoords = null;
    routeMode = false;
}

// Fonctions pour masquer/afficher les cartes d'établissements
function hideEstablishmentCards() {
    const establishmentsView = document.getElementById('establishments-view');
    const resultsCount = document.getElementById('results-count');
    const resetMapBtn = document.getElementById('reset-map');
    
    if (establishmentsView) {
        establishmentsView.classList.add('hide-establishments');
        establishmentsView.classList.remove('show-establishments');
    }
    
    if (resultsCount) {
        resultsCount.style.display = 'none';
    }
    
    if (resetMapBtn) {
        resetMapBtn.style.display = 'none';
    }
    
}

function showEstablishmentCards() {
    const establishmentsView = document.getElementById('establishments-view');
    const resultsCount = document.getElementById('results-count');
    const resetMapBtn = document.getElementById('reset-map');
    
    if (establishmentsView) {
        establishmentsView.classList.remove('hide-establishments');
        establishmentsView.classList.add('show-establishments');
    }
    
    if (resultsCount) {
        resultsCount.style.display = 'block';
    }
    
    if (resetMapBtn) {
        resetMapBtn.style.display = 'block';
    }
    
}

function showRouteDetails() {
    const routeDetailsPanel = document.getElementById('route-details-panel');
    const establishmentsView = document.getElementById('establishments-view');
    
    if (routeDetailsPanel) {
        routeDetailsPanel.style.display = 'block';
        routeDetailsPanel.classList.add('route-active');
    }
    
    hideEstablishmentCards();
    activateRouteMode();
    
}

function hideRouteDetails() {
    const routeDetailsPanel = document.getElementById('route-details-panel');
    
    if (routeDetailsPanel) {
        routeDetailsPanel.style.display = 'none';
        routeDetailsPanel.classList.remove('route-active');
    }
    
    showEstablishmentCards();
    deactivateRouteMode();
    
}

// Mode visuel avancé pour l'itinéraire
function activateRouteMode() {
    currentMode = 'route'; // Activer le mode itinéraire
    const mapContainer = document.getElementById('map-container');
    if (mapContainer) {
        mapContainer.classList.add('route-mode-active');
        
        // Animation fluide avec délai
        setTimeout(() => {
            if (map) {
                map.resize(); // Redimensionner la carte
            }
        }, 500);
    }
    
    // Ajout d'effets visuels sur la route
    addRouteVisualEffects();
    
}

function deactivateRouteMode() {
    currentMode = 'normal'; // Revenir au mode normal
    const mapContainer = document.getElementById('map-container');
    if (mapContainer) {
        mapContainer.classList.remove('route-mode-active');
        
        // Animation fluide avec délai
        setTimeout(() => {
            if (map) {
                map.resize(); // Redimensionner la carte
            }
        }, 500);
    }
    
    removeRouteVisualEffects();
    
}

// Effets visuels avancés pour la route
function addRouteVisualEffects() {
    if (!map || !map.getLayer('route')) return;
    
    // Ajouter l'animation de pulsation à la route
    try {
        map.setPaintProperty('route', 'line-opacity', 0.9);
        map.setPaintProperty('route', 'line-width', [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 6,
            18, 12
        ]);
        
        // Animation de la route (effet de pulsation)
        let opacity = 0.7;
        let direction = 1;
        
        const routeAnimation = setInterval(() => {
            if (!map || !map.getLayer('route')) {
                clearInterval(routeAnimation);
                return;
            }
            
            opacity += direction * 0.05;
            
            // S'assurer que l'opacité reste dans les limites [0.7, 1.0]
            opacity = Math.max(0.7, Math.min(1.0, opacity));
            
            if (opacity >= 1 || opacity <= 0.7) {
                direction *= -1;
            }
            
            try {
                map.setPaintProperty('route', 'line-opacity', opacity);
            } catch (e) {
                clearInterval(routeAnimation);
            }
        }, 100);
        
        // Stocker l'animation pour pouvoir l'arrêter
        window.routeAnimation = routeAnimation;
        
    } catch (error) {
    }
}

function removeRouteVisualEffects() {
    // Arrêter l'animation
    if (window.routeAnimation) {
        clearInterval(window.routeAnimation);
        window.routeAnimation = null;
    }
    
    // Restaurer les propriétés de la route
    try {
        if (map && map.getLayer('route')) {
            map.setPaintProperty('route', 'line-opacity', 0.8);
            map.setPaintProperty('route', 'line-width', 5);
        }
    } catch (error) {
    }
}

// Fonction pour mettre à jour uniquement le résumé de l'itinéraire
function updateRouteSummary(routeData) {
    const routeDistance = document.getElementById('route-distance');
    const routeDuration = document.getElementById('route-duration');
    const routeVehicleInfo = document.getElementById('route-vehicle-info');
    
    if (!routeData || !routeData.routes || !routeData.routes[0]) {
        return;
    }
    
    const route = routeData.routes[0];
    
    // Mise à jour du résumé
    const totalDistance = (route.distance / 1000).toFixed(1);
    const totalDurationHours = Math.floor(route.duration / 3600);
    const totalDurationMinutes = Math.floor((route.duration % 3600) / 60);
    
    routeDistance.textContent = `${totalDistance} km`;
    routeDuration.textContent = `${totalDurationHours}h ${totalDurationMinutes}min`;
    
    // Mise à jour des infos véhicule
    const vehicleText = currentVehicleType === 'driving-traffic' ? 'Poids lourd' : 'Voiture';
    const tollText = currentTollOption === 'avoid' ? 'Péages évités' : 'Péages autorisés';
    routeVehicleInfo.innerHTML = `Type: ${vehicleText} • ${tollText}`;
    
}

function initializeRouteInterface() {
    const addDestinationBtn = document.getElementById('add-destination-btn');
    const clearRouteBtn = document.getElementById('clear-route-btn');
    const pointASection = document.getElementById('point-a-section');
    const pointBSection = document.getElementById('point-b-section');
    
    // Initialiser les switchers de routage
    initializeRouteSwitchers();
    
    // Event listeners pour tracker le focus
    if (pointASection) {
        pointASection.addEventListener('click', () => {
            setFocusOnPointA();
        });
    }
    
    if (pointBSection) {
        pointBSection.addEventListener('click', () => {
            setFocusOnPointB();
        });
    }
    
    // Bouton pour expand/collapse le Point B
    if (addDestinationBtn) {
        addDestinationBtn.addEventListener('click', () => {
            togglePointB();
        });
    }
    
    // Plus besoin de bouton calculer - c'est automatique avec les boutons d'options
    
    // Effacer l'itinéraire
    if (clearRouteBtn) {
        clearRouteBtn.addEventListener('click', () => {
            clearCurrentRoute();
            destinationCoords = null;
            clearPointBDisplay();
            // Réinitialiser le geocoder B
            if (geocoderB) {
                geocoderB.clear();
            }
            hidePointB(); // Masquer le Point B après effacement
            hideRouteDetails(); // Masquer le panneau de détails
        });
    }
    
    // Bouton retour à la recherche
    const backToSearchBtn = document.getElementById('back-to-search-btn');
    if (backToSearchBtn) {
        backToSearchBtn.addEventListener('click', () => {
            hideRouteDetails();
            clearCurrentRoute();
        });
    }
    
}

// Variables pour les options de routage actuelles
let currentVehicleType = 'driving';
let currentTollOption = 'allow';

// Initialiser les switchers de routage
function initializeRouteSwitchers() {
    // Switcher véhicule
    const vehicleCar = document.getElementById('vehicle-car');
    const vehicleTruck = document.getElementById('vehicle-truck');
    
    if (vehicleCar && vehicleTruck) {
        vehicleCar.addEventListener('click', () => {
            vehicleCar.classList.add('active');
            vehicleTruck.classList.remove('active');
            vehicleCar.style.background = '#007bff';
            vehicleCar.style.color = 'white';
            vehicleTruck.style.background = 'transparent';
            vehicleTruck.style.color = '#6c757d';
            
            currentVehicleType = 'driving';
            recalculateRoute();
        });
        
        vehicleTruck.addEventListener('click', () => {
            vehicleTruck.classList.add('active');
            vehicleCar.classList.remove('active');
            vehicleTruck.style.background = '#ffc107';
            vehicleTruck.style.color = 'white';
            vehicleCar.style.background = 'transparent';
            vehicleCar.style.color = '#6c757d';
            
            currentVehicleType = 'driving-traffic';
            recalculateRoute();
        });
    }
    
    // Switcher péages
    const tollAllow = document.getElementById('toll-allow');
    const tollAvoid = document.getElementById('toll-avoid');
    
    if (tollAllow && tollAvoid) {
        tollAllow.addEventListener('click', () => {
            tollAllow.classList.add('active');
            tollAvoid.classList.remove('active');
            tollAllow.style.background = '#28a745';
            tollAllow.style.color = 'white';
            tollAvoid.style.background = 'transparent';
            tollAvoid.style.color = '#6c757d';
            
            currentTollOption = 'allow';
            recalculateRoute();
        });
        
        tollAvoid.addEventListener('click', () => {
            tollAvoid.classList.add('active');
            tollAllow.classList.remove('active');
            tollAvoid.style.background = '#dc3545';
            tollAvoid.style.color = 'white';
            tollAllow.style.background = 'transparent';
            tollAllow.style.color = '#6c757d';
            
            currentTollOption = 'avoid';
            recalculateRoute();
        });
    }
    
    // Toggle pour les options de routage (molette)
    const toggleBtn = document.getElementById('toggle-route-options');
    const optionsContainer = document.getElementById('route-options-container');
    
    if (toggleBtn && optionsContainer) {
        toggleBtn.addEventListener('click', () => {
            const isHidden = optionsContainer.style.display === 'none';
            
            if (isHidden) {
                optionsContainer.style.display = 'block';
                optionsContainer.style.opacity = '0';
                optionsContainer.style.transform = 'translateY(-10px)';
                
                setTimeout(() => {
                    optionsContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    optionsContainer.style.opacity = '1';
                    optionsContainer.style.transform = 'translateY(0)';
                }, 10);
                
                toggleBtn.style.background = 'rgba(255,255,255,0.3)';
                toggleBtn.title = 'Masquer les options';
            } else {
                optionsContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                optionsContainer.style.opacity = '0';
                optionsContainer.style.transform = 'translateY(-10px)';
                
                setTimeout(() => {
                    optionsContainer.style.display = 'none';
                }, 300);
                
                toggleBtn.style.background = 'rgba(255,255,255,0.2)';
                toggleBtn.title = 'Options de routage';
            }
        });
        
        // Effet hover sur la molette
        toggleBtn.addEventListener('mouseenter', () => {
            toggleBtn.style.background = 'rgba(255,255,255,0.3)';
            toggleBtn.style.transform = 'scale(1.1)';
        });
        
        toggleBtn.addEventListener('mouseleave', () => {
            const isOptionsVisible = optionsContainer.style.display !== 'none';
            toggleBtn.style.background = isOptionsVisible ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.2)';
            toggleBtn.style.transform = 'scale(1)';
        });
    }
}

// Auto-recalcul quand les options changent
function recalculateRoute() {
    if (currentSearchCenter && destinationCoords) {
        // Vérifier qu'au moins un est une UP
        if (!isPointAFromUP && !isPointBFromUP) {
            showCityToCityError();
            return;
        }
        showRouteOnMap(currentSearchCenter, destinationCoords);
    }
}

async function searchDestination() {
    const destinationInput = document.getElementById('destination-input');
    const query = destinationInput.value.trim();
    
    if (!query) {
        alert('Veuillez saisir une adresse de destination.');
        return;
    }
    
    try {
        const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=fr&access_token=${mapboxgl.accessToken}`);
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            const feature = data.features[0];
            destinationCoords = feature.center;
            
            // Mettre à jour le placeholder avec le lieu trouvé
            destinationInput.value = feature.place_name;
            
            // Ajouter un marker temporaire pour la destination
            addDestinationMarker(destinationCoords);
            
            // Zoomer sur la destination
            map.flyTo({ 
                center: destinationCoords, 
                zoom: 12, 
                essential: true 
            });
        } else {
            alert('Aucun résultat trouvé pour cette adresse.');
        }
    } catch (error) {
        alert('Erreur lors de la recherche. Veuillez réessayer.');
    }
}

function addDestinationMarker(coords) {
    // Supprimer l'ancien marker de destination s'il existe
    removeDestinationMarker();
    
    // Créer un nouveau marker pour la destination
    const marker = new mapboxgl.Marker({ 
        color: '#ff0000',
        scale: 1.2
    })
    .setLngLat(coords)
    .addTo(map);
    
    // Stocker le marker pour pouvoir le supprimer plus tard
    window.destinationMarker = marker;
}

function removeDestinationMarker() {
    if (window.destinationMarker) {
        window.destinationMarker.remove();
        window.destinationMarker = null;
    }
}

// Fonctions pour contrôler l'affichage du sélecteur de rayon
function showRadiusControl() {
    let radiusControl = document.getElementById('map-radius-control-overlay');
    
    if (!radiusControl) {
        // Créer l'élément dynamiquement
        radiusControl = document.createElement('div');
        radiusControl.id = 'map-radius-control-overlay';
        radiusControl.className = 'map-radius-control';
        radiusControl.style.cssText = 'position:absolute;bottom:260px;left:10px;background:#fff;padding:12px 15px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.2);z-index:9;font-size:13px;display:block;';
        
        // Créer le contenu sans innerHTML pour éviter les problèmes d'iframe
        const h4 = document.createElement('h4');
        h4.style.cssText = 'margin:0 0 0 0;font-size:14px;color:#333;font-weight:bold;cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;';
        h4.textContent = 'Rayon de recherche';
        h4.addEventListener('click', () => {
            radiusControl.classList.toggle('collapsed');
        });
        
        const radiusContent = document.createElement('div');
        radiusContent.className = 'radius-control-content';
        
        const controlDiv = document.createElement('div');
        controlDiv.style.cssText = 'display:flex;align-items:center;gap:10px;';
        
        const label = document.createElement('label');
        label.style.cssText = 'font-size:13px;color:#333;white-space:nowrap;';
        label.textContent = 'Rayon:';
        
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = 'radius-slider';
        slider.value = '80';
        slider.min = '1';
        slider.max = '200';
        slider.step = '1';
        slider.style.cssText = 'flex:1;min-width:120px;';
        
        const valueSpan = document.createElement('span');
        valueSpan.id = 'radius-value';
        valueSpan.style.cssText = 'font-weight:bold;color:#002060;min-width:50px;font-size:13px;';
        valueSpan.textContent = '80 km';
        
        controlDiv.appendChild(label);
        controlDiv.appendChild(slider);
        controlDiv.appendChild(valueSpan);
        
        radiusContent.appendChild(controlDiv);
        
        radiusControl.appendChild(h4);
        radiusControl.appendChild(radiusContent);
        
        // Ajouter à la carte
        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            mapContainer.appendChild(radiusControl);
        } else {
            return;
        }
    } else {
        radiusControl.style.display = 'block';
    }
    
    // Ajouter les event listeners maintenant que l'élément est visible
    initializeRadiusControlListeners();
    
    // Positionner le contrôle de rayon par rapport à la légende
    updateRadiusControlPosition();
}

// Fonction pour mettre à jour la position du contrôle de rayon
function updateRadiusControlPosition() {
    const radiusControl = document.getElementById('map-radius-control-overlay');
    const mapLegend = document.querySelector('.map-legend');
    const mapContainer = document.getElementById('map-container');
    
    if (radiusControl && mapLegend) {
        // Vérifier si on est en mode map-full pour prendre en compte le scale
        const isMapFull = mapContainer && mapContainer.classList.contains('layout-map-full');
        const scaleFactor = isMapFull ? 0.65 : 1;
        
        // Obtenir la hauteur réelle de la légende (avec scale)
        const legendHeight = mapLegend.offsetHeight * scaleFactor;
        
        // Obtenir la position bottom actuelle de la légende depuis son style CSS
        const legendBottomStyle = window.getComputedStyle(mapLegend).bottom;
        const legendBottom = parseInt(legendBottomStyle) || 30;
        
        // Obtenir la position left de la légende
        const legendLeftStyle = window.getComputedStyle(mapLegend).left;
        const legendLeft = parseInt(legendLeftStyle) || 10;
        
        // Positionner juste au-dessus avec un espace minimal
        const newBottom = legendBottom + legendHeight + 2;
        radiusControl.style.bottom = newBottom + 'px';
        
        // Aligner horizontalement avec la légende
        radiusControl.style.left = legendLeft + 'px';
        
        // S'assurer que le z-index permet l'affichage simultané
        radiusControl.style.zIndex = '901'; // Au-dessus de la légende (900)
    }
}

// Variable pour éviter d'ajouter les listeners plusieurs fois
let radiusControlListenersInitialized = false;

function initializeRadiusControlListeners() {
    if (radiusControlListenersInitialized) return;
    
    const radiusSlider = document.getElementById('radius-slider');
    const radiusValue = document.getElementById('radius-value');
    
    if (radiusSlider && radiusValue) {
        radiusSlider.addEventListener('input', () => {
            radiusValue.textContent = `${radiusSlider.value} km`;
        });
        
        radiusSlider.addEventListener('change', debounce(() => {
            if (currentSearchCenter) { applyFilters(); }
        }, 300));
        
        radiusControlListenersInitialized = true;
    } else {
    }
}

function hideRadiusControl() {
    const radiusControl = document.getElementById('map-radius-control-overlay');
    if (radiusControl) {
        radiusControl.style.display = 'none';
    } else {
    }
}

function applyFilters() {
    const radiusSlider = document.getElementById('radius-slider');
    currentSearchRadius = radiusSlider ? parseInt(radiusSlider.value, 10) : 80;

    if (currentSearchCenter) {
        drawSearchRadiusCircle(currentSearchCenter, currentSearchRadius);
    }

    let featuresToDisplay = [...establishmentsData.features];
    
    // Filtrer par activité selon la légende interactive
    // Si aucun filtre n'est actif, afficher tout
    if (activeFilters.size > 0) {
        featuresToDisplay = featuresToDisplay.filter(feature => {
            const activityType = getActivityType(feature.properties.activity);
            // Pour ciment, il faut gérer aussi ciment-prompt
            if (activityType === 'ciment-prompt' && activeFilters.has('ciment')) {
                return false; // Ne pas afficher ciment-prompt si on veut seulement ciment
            }
            return activeFilters.has(activityType);
        });
    }
    
    // Filtrer par distance si un centre de recherche est défini
    if (currentSearchCenter && !isNaN(currentSearchRadius) && currentSearchRadius > 0) {
        featuresToDisplay = featuresToDisplay.filter(feature => {
            if (!feature.geometry || !feature.geometry.coordinates) return false;
            const distance = getDistanceFromLatLonInKm(currentSearchCenter[1], currentSearchCenter[0], feature.geometry.coordinates[1], feature.geometry.coordinates[0]);
            return distance <= currentSearchRadius;
        });
    }
    
    
    primaryFilteredFeatures = featuresToDisplay;
    
    // Mettre à jour la source avec les données filtrées
    updateEstablishmentsSource(featuresToDisplay);
    adjustMapView(primaryFilteredFeatures);
    // Le compteur est maintenant mis à jour dans updateSidebarCards() pour refléter les établissements visibles
}

function adjustMapView(features) {
    if (features.length === 1 && currentSearchCenter) {
        map.flyTo({ center: features[0].geometry.coordinates, zoom: 10, essential: true });
    } else if (features.length === 0 && currentSearchCenter) {
        map.flyTo({ center: currentSearchCenter, zoom: 9, essential: true });
    } else if (features.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        features.forEach(feature => {
            if (feature.geometry && feature.geometry.coordinates) { bounds.extend(feature.geometry.coordinates); }
        });
        if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 70, maxZoom: 15, duration: 500 });
        }
    } else if (features.length === 0 && !currentSearchCenter) {
        map.flyTo({ center: [2.2137, 46.2276], zoom: 5, pitch: 0, bearing: 0 });
    }
    setTimeout(updateSidebarBasedOnMapViewport, 100);
}

function resetMap() {
    
    const radiusSlider = document.getElementById('radius-slider');
    if (radiusSlider) radiusSlider.value = 80;
    
    const radiusValue = document.getElementById('radius-value');
    if (radiusValue) radiusValue.textContent = "80 km";
    
    // Réinitialiser toutes les variables d'état
    currentSearchCenter = null;
    currentSearchRadius = 80;
    destinationCoords = null;
    currentFocusedInput = 'A'; // Remettre le focus sur A
    currentPointAFeature = null;
    currentPointBFeature = null;
    isPointAFromUP = false;
    isPointBFromUP = false;
    
    removeSearchRadiusCircle();
    clearPointADisplay();
    clearCurrentRoute(); // Effacer la route tracée
    
    // Fermer tous les popups ouverts
    activePopups.forEach(p => p.remove());
    activePopups.length = 0;
    
    // Supprimer le marker de géolocalisation s'il existe
    if (userLocationMarker) {
        userLocationMarker.remove();
        userLocationMarker = null;
    }
    
    // Réinitialiser les filtres de légende (aucun filtre = tout affiché)
    activeFilters.clear();
    updateLegendVisualState();
    
    // Réinitialiser l'interface d'itinéraire
    hideRouteInterface();
    removeDestinationMarker();
    const destinationInput = document.getElementById('destination-input');
    if (destinationInput) destinationInput.value = '';
    
    // Cacher le contrôle de rayon
    hideRadiusControl();
    
    // Vider les geocoders
    if (geocoder && typeof geocoder.clear === 'function') { geocoder.clear(); }
    if (geocoderB && typeof geocoderB.clear === 'function') { geocoderB.clear(); }
    if (window.normalGeocoder && typeof window.normalGeocoder.clear === 'function') { 
        window.normalGeocoder.clear(); 
    }
    
    checkAndSetLayout();
    map.flyTo({ center: [2.2137, 46.2276], zoom: 5, pitch: 0, bearing: 0, essential: true });
    setTimeout(applyFilters, 100);
}

function createMarkerElement(activity) {
  let el;
  
  // Fonction pour créer un marqueur coloré de fallback
  function createColoredMarker(color) {
    const marker = document.createElement('div');
    marker.style.width = '24px';
    marker.style.height = '24px';
    marker.style.borderRadius = '50%';
    marker.style.border = '3px solid white';
    marker.style.boxShadow = '0 2px 4px rgba(0,0,0,0.4)';
    marker.style.cursor = 'pointer';
    marker.style.backgroundColor = color;
    
    // Ajouter un effet de hover
    marker.addEventListener('mouseenter', function() {
      this.style.transform = 'scale(1.2)';
      this.style.transition = 'transform 0.2s';
    });
    
    marker.addEventListener('mouseleave', function() {
      this.style.transform = 'scale(1)';
    });
    
    return marker;
  }
  
  // Essayer d'utiliser les images d'abord
  if (activity === "beton") {
    el = document.createElement('img');
    el.src = 'https://www.solutions-vicat.fr/sites/default/files/2024-09/point-interet-beton.png';
    el.onerror = function() {
      // Si l'image ne charge pas, utiliser un marqueur coloré
      const fallback = createColoredMarker('#FF6B6B');
      this.parentNode.replaceChild(fallback, this);
    };
  } else if (activity === "granulats") {
    el = document.createElement('img');
    el.src = 'https://www.solutions-vicat.fr/sites/default/files/2024-09/point-interet-granulats.png';
    el.onerror = function() {
      const fallback = createColoredMarker('#4ECDC4');
      this.parentNode.replaceChild(fallback, this);
    };
  } else if (activity === "ciment-prompt") {
    el = document.createElement('img');
    el.src = 'https://www.solutions-vicat.fr/sites/default/files/2024-12/ciment-prompt-naturel.png';
    el.onerror = function() {
      const fallback = createColoredMarker('#45B7D1');
      this.parentNode.replaceChild(fallback, this);
    };
  } else if (activity === "ciment") {
    el = document.createElement('img');
    el.src = 'https://www.solutions-vicat.fr/sites/default/files/2024-09/point-interet-ciment.png';
    el.onerror = function() {
      const fallback = createColoredMarker('#002060');
      this.parentNode.replaceChild(fallback, this);
    };
  } else {
    // Pour les autres activités, utiliser directement un marqueur coloré
    el = createColoredMarker('#95A5A6');
  }
  
  // Si c'est une image, définir les styles appropriés
  if (el.tagName === 'IMG') {
    el.style.width = '30px';
    el.style.height = '30px';
    el.style.cursor = 'pointer';
  }
  
  return el;
}

function createPopupContent(props, coordinates = null, popupType = 'default') {
    const name = decodeHTMLEntities(props.UP||'N/A');
    const address = decodeHTMLEntities(props.Adresse||'N/A');
    const city = decodeHTMLEntities(props.Ville||'');
    const postalCode = props["Code postal"]||'';
    const phone = props.Phone&&props.Phone!=="null"?props.Phone:null;
    const email = props.Email&&props.Email!=="null"?props.Email:null;
	const url = props.url&&props.url!=="null"?props.url:null;
    
    let distanceInfo = '';
    if (currentSearchCenter && coordinates) {
        let distance, travelTime;
        
        // Utiliser les données réelles de routage si disponibles, sinon calcul à vol d'oiseau
        if (realRouteData) {
            distance = parseFloat(realRouteData.distance);
            travelTime = realRouteData.travelTime;
        } else {
            distance = getDistanceFromLatLonInKm(
                currentSearchCenter[1], currentSearchCenter[0],
                coordinates[1], coordinates[0]
            );
            travelTime = calculateTravelTime(distance);
        }
        
        // Ne pas afficher les badges si distance = 0 ou temps = "0 min"
        const distanceValue = distance.toFixed ? distance.toFixed(1) : distance;
        if (parseFloat(distanceValue) > 0 && travelTime !== "0 min") {
            distanceInfo = `<p><strong>Distance:</strong><span class="distance-badge">${distanceValue} km</span><span class="time-badge">${travelTime}</span></p>`;
        }
    }
    
    // Créer le popup avec les options appropriées selon le type
    let popupOptions;
    if (popupType === 'clicked') {
        popupOptions = { 
            offset: 25, 
            maxWidth: '300px', 
            closeButton: true,  // CROIX pour le popup cliqué
            closeOnClick: false, 
            className: 'clicked-popup' 
        };
    } else if (popupType === 'hover') {
        popupOptions = { 
            offset: 25, 
            maxWidth: '300px', 
            closeButton: true,  // CROIX aussi pour le hover
            closeOnClick: false, 
            className: 'hover-tooltip' 
        };
    } else {
        // default
        popupOptions = { 
            offset: 25, 
            maxWidth: '300px', 
            closeButton: true,  // CROIX par défaut partout
            closeOnClick: false 
        };
    }
    
    const popup = new mapboxgl.Popup(popupOptions);
    
    // Créer le contenu avec DOM pour éviter les problèmes de balises
    const popupDiv = document.createElement('div');
    
    // Titre
    const title = document.createElement('h3');
    title.textContent = name;
    popupDiv.appendChild(title);
    
    // Adresse
    const addressP = document.createElement('p');
    const addressStrong = document.createElement('strong');
    addressStrong.textContent = 'Adresse: ';
    addressP.appendChild(addressStrong);
    addressP.appendChild(document.createTextNode(address));
    addressP.appendChild(document.createElement('br'));
    addressP.appendChild(document.createTextNode(city + ' ' + postalCode));
    popupDiv.appendChild(addressP);
    
    // Distance (si disponible)
    if (currentSearchCenter && coordinates) {
        let distance, travelTime;
        
        // Vérifier si c'est l'établissement de destination
        const isDestination = destinationCoords && 
            Math.abs(coordinates[0] - destinationCoords[0]) < 0.0001 &&
            Math.abs(coordinates[1] - destinationCoords[1]) < 0.0001;
        
        // Utiliser les données réelles de routage si disponibles, sinon calcul à vol d'oiseau
        if (realRouteData) {
            distance = parseFloat(realRouteData.distance);
            travelTime = realRouteData.travelTime;
        } else {
            distance = getDistanceFromLatLonInKm(
                currentSearchCenter[1], currentSearchCenter[0],
                coordinates[1], coordinates[0]
            );
            travelTime = calculateTravelTime(distance);
        }
        
        // Arrondir la distance pour les popups aussi
        let distanceDisplay;
        if (isDestination && realRouteData) {
            distanceDisplay = distance.toFixed(1) + ' km';
        } else {
            if (distance < 10) {
                distanceDisplay = '~' + Math.round(distance) + ' km';
            } else if (distance < 50) {
                distanceDisplay = '~' + (Math.round(distance / 5) * 5) + ' km';
            } else {
                distanceDisplay = '~' + (Math.round(distance / 10) * 10) + ' km';
            }
        }
        
        if (distance > 0 && travelTime !== "0 min") {
            const distanceP = document.createElement('p');
            const distanceStrong = document.createElement('strong');
            distanceStrong.textContent = 'Distance: ';
            distanceP.appendChild(distanceStrong);
            
            const distanceBadge = document.createElement('span');
            distanceBadge.className = 'distance-badge';
            distanceBadge.textContent = distanceDisplay;
            distanceBadge.title = (isDestination && realRouteData) ? 
                'Distance réelle par la route' : 
                'Distance approximative à vol d\'oiseau';
            distanceP.appendChild(distanceBadge);
            
            const timeBadge = document.createElement('span');
            timeBadge.className = 'time-badge';
            timeBadge.textContent = travelTime;
            timeBadge.title = (isDestination && realRouteData) ? 
                'Temps de trajet réel' : 
                'Estimation du temps de trajet';
            distanceP.appendChild(timeBadge);
            
            popupDiv.appendChild(distanceP);
        }
    }
    
    // Téléphone
    const phoneP = document.createElement('p');
    const phoneStrong = document.createElement('strong');
    phoneStrong.textContent = 'T\u00E9l\u00E9phone: ';
    phoneP.appendChild(phoneStrong);
    if (phone) {
        const phoneLink = document.createElement('a');
        phoneLink.href = 'tel:' + phone;
        phoneLink.textContent = phone;
        phoneP.appendChild(phoneLink);
    } else {
        phoneP.appendChild(document.createTextNode('Non disponible'));
    }
    popupDiv.appendChild(phoneP);
    
    // Email
    const emailP = document.createElement('p');
    const emailStrong = document.createElement('strong');
    emailStrong.textContent = 'Email: ';
    emailP.appendChild(emailStrong);
    if (email) {
        const emailLink = document.createElement('a');
        emailLink.href = 'mailto:' + email;
        emailLink.textContent = email;
        emailP.appendChild(emailLink);
    } else {
        emailP.appendChild(document.createTextNode('Non disponible'));
    }
    popupDiv.appendChild(emailP);
    
	// Bouton page
	const urlP = document.createElement('p');

    if (url) {
        const urlBtn = document.createElement('a');
        urlBtn.href = url;
        urlBtn.textContent = 'En savoir plus';
        urlP.appendChild(urlBtn);
    } else {
        //emailP.appendChild(document.createTextNode('Non disponible'));
    }
    popupDiv.appendChild(urlP);
	
    // Ajout du bouton approprié selon le contexte
    const currentZoom = map.getZoom();
    const currentPitch = map.getPitch();
    const mapCenter = map.getCenter();
    
    // Calculer la distance entre le centre de la carte et cette UP
    const centerDistance = turf.distance(
        turf.point([mapCenter.lng, mapCenter.lat]),
        turf.point(coordinates),
        { units: 'kilometers' }
    );
    
    // Utiliser EXACTEMENT la même logique que les cards pour la cohérence
    // On est en vue 3D uniquement si :
    // 1. Le pitch est élevé (> 45°) ET
    // 2. Le zoom est important (>= 16) ET
    // 3. On est proche du centre
    const isIn3DView = (
        currentPitch > 45 && // DOIT avoir un pitch élevé pour être en 3D
        currentZoom >= 16 && // DOIT être zoomé
        centerDistance < 0.5 // DOIT être proche du centre
    );
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'popup-actions';
    
    const viewBtn = document.createElement('button');
    viewBtn.className = 'popup-view-btn';
    
    if (isIn3DView) {
        // Bouton "Retour à la carte" car on est EN VUE 3D sur cette UP
        viewBtn.textContent = 'Retour a la carte';
        viewBtn.style.backgroundColor = '#28a745';
        viewBtn.onclick = function() {
            // Réinitialiser les variables de tracking
            currentView3DCoordinates = null;
            
            // Fermer le popup actuel
            const popup = activePopups.find(p => {
                const popupLngLat = p.getLngLat();
                return Math.abs(popupLngLat.lng - coordinates[0]) < 0.0001 && 
                       Math.abs(popupLngLat.lat - coordinates[1]) < 0.0001;
            });
            if (popup) {
                popup.remove();
                const index = activePopups.indexOf(popup);
                if (index > -1) activePopups.splice(index, 1);
            }
            // Le popup est déjà fermé via activePopups ci-dessus
            
            map.flyTo({
                center: coordinates,
                zoom: 12,
                pitch: 0,
                bearing: 0,
                speed: 1.2,
                essential: true
            });
            
            updateSidebarBasedOnMapViewport();
        };
    } else {
        // Bouton "Voir en 3D" car on n'est pas zoomé sur cette UP
        viewBtn.textContent = 'Voir en 3D';
        viewBtn.onclick = function() {
            // Fonction pour effectuer le zoom 3D
            const doZoom3D = () => {
                // Marquer qu'on est en train de zoomer vers cette UP EN 3D
                currentView3DCoordinates = coordinates;
                
                // Fermer le popup actuel
                const popup = activePopups.find(p => {
                    const popupLngLat = p.getLngLat();
                    return Math.abs(popupLngLat.lng - coordinates[0]) < 0.0001 && 
                           Math.abs(popupLngLat.lat - coordinates[1]) < 0.0001;
                });
                if (popup) {
                    popup.remove();
                    const index = activePopups.indexOf(popup);
                    if (index > -1) activePopups.splice(index, 1);
                }
                // Fermer aussi le clickedPopup global s'il existe
                // Le popup est déjà fermé via activePopups ci-dessus
                
                map.flyTo({
                    center: coordinates,
                    zoom: 17,
                    pitch: 60,
                    bearing: 30,
                    speed: 1.2,
                    essential: true
                });
                
                updateSidebarBasedOnMapViewport();
            };
            
            // Si on est en mode liste, basculer vers la vue carte d'abord
            if (window.getCurrentLayoutMode && window.getCurrentLayoutMode() === 'sidebarFull') {
                window.switchToMapFullScreen();
                // Attendre que le changement de vue soit effectué
                setTimeout(doZoom3D, 600);
            } else {
                // Sinon, faire le zoom directement
                doZoom3D();
            }
        };
    }
    
    actionsDiv.appendChild(viewBtn);
    popupDiv.appendChild(actionsDiv);
    
    popup.setDOMContent(popupDiv);
    
    return popup;
}

function updatePointADisplay(properties) {
    const selectedPointA = document.getElementById('selected-point-a');
    const pointAName = document.getElementById('point-a-name');
    const pointASection = document.getElementById('point-a-section');
    const geocoderContainer = document.getElementById('geocoder-container');
    const clearPointA = document.getElementById('clear-point-a');
    
    if (selectedPointA && pointAName) {
        // Utiliser le nom complet de l'UP
        const displayName = properties.UP || properties['Nom du site'] || properties['Nom_du_site'] || '\u00C9tablissement s\u00E9lectionn\u00E9';
        
        // Afficher l'élément avec le nom
        pointAName.textContent = displayName;
        selectedPointA.style.display = 'block';
        
        // Cacher le geocoder quand un point est sélectionné
        if (geocoderContainer) {
            geocoderContainer.style.display = 'none';
        }
        
        // Ajouter l'event listener sur la croix
        if (clearPointA) {
            clearPointA.addEventListener('click', clearPointASelection);
        }
        
        // Ajouter une bordure colorée à la section Point A
        if (pointASection) {
            pointASection.style.borderColor = '#1976d2';
            pointASection.style.borderWidth = '2px';
        }
    }
}

function clearPointADisplay() {
    const selectedPointA = document.getElementById('selected-point-a');
    const pointASection = document.getElementById('point-a-section');
    const geocoderContainer = document.getElementById('geocoder-container');
    
    if (selectedPointA) {
        selectedPointA.style.display = 'none';
    }
    
    // Réafficher le geocoder
    if (geocoderContainer) {
        geocoderContainer.style.display = 'flex';
    }
    
    if (pointASection) {
        pointASection.style.borderColor = '#ddd';
        pointASection.style.borderWidth = '1px';
    }
}

function updatePointBDisplay(properties) {
    const selectedPointB = document.getElementById('selected-point-b');
    const pointBName = document.getElementById('point-b-name');
    const pointBSection = document.getElementById('point-b-section');
    const geocoderContainerB = document.getElementById('geocoder-container-b');
    const clearPointB = document.getElementById('clear-point-b');
    
    if (selectedPointB && pointBName) {
        // Utiliser le nom complet de l'UP
        const displayName = properties.UP || properties['Nom du site'] || properties['Nom_du_site'] || '\u00C9tablissement s\u00E9lectionn\u00E9';
        
        // Afficher l'élément avec le nom
        pointBName.textContent = displayName;
        selectedPointB.style.display = 'block';
        
        // Cacher le geocoder B quand un point est sélectionné
        if (geocoderContainerB) {
            geocoderContainerB.style.display = 'none';
        }
        
        // Ajouter l'event listener sur la croix
        if (clearPointB) {
            clearPointB.addEventListener('click', clearPointBSelection);
        }
        
        // Ajouter une bordure colorée à la section Point B
        if (pointBSection) {
            pointBSection.style.borderColor = '#ffc107';
            pointBSection.style.borderWidth = '2px';
        }
    }
}

function clearPointBDisplay() {
    const selectedPointB = document.getElementById('selected-point-b');
    const pointBSection = document.getElementById('point-b-section');
    const geocoderContainerB = document.getElementById('geocoder-container-b');
    
    if (selectedPointB) {
        selectedPointB.style.display = 'none';
    }
    
    // Réafficher le geocoder B
    if (geocoderContainerB) {
        geocoderContainerB.style.display = 'flex';
    }
    
    if (pointBSection) {
        pointBSection.style.borderColor = '#ddd';
        pointBSection.style.borderWidth = '1px';
    }
}

function setFocusOnPointA() {
    currentFocusedInput = 'A';
    const pointASection = document.getElementById('point-a-section');
    const pointBSection = document.getElementById('point-b-section');
    
    if (pointASection) {
        pointASection.style.borderColor = '#1976d2';
        pointASection.style.borderWidth = '3px';
        pointASection.style.boxShadow = '0 2px 8px rgba(25, 118, 210, 0.3)';
    }
    
    if (pointBSection) {
        pointBSection.style.borderColor = '#ddd';
        pointBSection.style.borderWidth = '1px';
        pointBSection.style.boxShadow = 'none';
    }
    
}

function setFocusOnPointB() {
    currentFocusedInput = 'B';
    const pointASection = document.getElementById('point-a-section');
    const pointBSection = document.getElementById('point-b-section');
    
    if (pointASection) {
        pointASection.style.borderColor = '#ddd';
        pointASection.style.borderWidth = '1px';
        pointASection.style.boxShadow = 'none';
    }
    
    if (pointBSection) {
        pointBSection.style.borderColor = '#ff9800';
        pointBSection.style.borderWidth = '3px';
        pointBSection.style.boxShadow = '0 2px 8px rgba(255, 152, 0, 0.3)';
    }
    
}

function clearPointASelection() {
    // Réinitialiser les variables
    currentSearchCenter = null;
    currentPointAFeature = null;
    
    // Cacher l'affichage du Point A sélectionné
    clearPointADisplay();
    
    // Réafficher le geocoder A
    const geocoderContainer = document.getElementById('geocoder-container');
    if (geocoderContainer) {
        geocoderContainer.style.display = 'flex';
    }
    
    // Réinitialiser le geocoder A sans déclencher l'événement clear
    if (geocoder) {
        // Nettoyer manuellement l'input du geocoder plutôt que d'utiliser .clear()
        const geocoderInput = geocoderContainer.querySelector('input');
        if (geocoderInput) {
            geocoderInput.value = '';
        }
        // Alternative : utiliser setInput si disponible
        if (typeof geocoder.setInput === 'function') {
            geocoder.setInput('');
        }
    }
    
    // Supprimer le trajet (mais garder Point B si il est sélectionné)
    clearCurrentRoute();
    
    // Remettre le focus sur A
    setFocusOnPointA();
    
    // Gérer le rayon intelligemment selon la présence de Point B (sauf en mode itinéraire)
    if (!isRouteMode) {
        const pointBCoords = getCurrentPointBCoords();
        if (pointBCoords) {
            // Si Point B existe, l'utiliser comme nouveau centre pour le rayon
            currentSearchCenter = pointBCoords;
            // Maintenir le contrôle de rayon visible et redessiner le cercle
            const radiusControl = document.querySelector('.map-radius-control');
            if (radiusControl) {
                radiusControl.style.display = 'block';
                updateRadiusControlPosition();
            }
            
            drawSearchRadiusCircle(pointBCoords, currentSearchRadius);
        } else {
            // Si Point B n'existe pas, comportement normal (cacher le rayon)
            const radiusControl = document.querySelector('.map-radius-control');
            if (radiusControl) radiusControl.style.display = 'none';
            removeSearchRadiusCircle();
        }
    }
    
    // Réappliquer les filtres avec le nouveau contexte
    applyFilters();
    
    // Mettre à jour la taille des pins sélectionnés
    updateSelectedPointsSize();
}

function clearPointBSelection() {
    // Réinitialiser la destination
    destinationCoords = null;
    currentPointBFeature = null;
    isPointBFromUP = false;
    
    // Cacher l'affichage du Point B sélectionné
    clearPointBDisplay();
    
    // Réafficher le geocoder B
    const geocoderContainerB = document.getElementById('geocoder-container-b');
    if (geocoderContainerB) {
        geocoderContainerB.style.display = 'flex';
    }
    
    // Réinitialiser le geocoder B
    if (geocoderB) {
        geocoderB.clear();
    }
    
    // Supprimer le trajet actuel
    clearCurrentRoute();
    
    // Mettre à jour la taille des pins sélectionnés
    updateSelectedPointsSize();
}

function areCoordinatesIdentical(coords1, coords2, tolerance = 0.00001) {
    if (!coords1 || !coords2) return false;
    return Math.abs(coords1[0] - coords2[0]) < tolerance && Math.abs(coords1[1] - coords2[1]) < tolerance;
}

function areEstablishmentsIdentical(feature1, feature2) {
    // Vérification robuste pour identifier si deux établissements sont identiques
    if (!feature1 || !feature2) return false;
    
    // Comparaison par propriété UP (identifiant principal)
    const up1 = feature1.properties?.UP;
    const up2 = feature2.properties?.UP;
    if (up1 && up2 && up1 === up2) {
        return true;
    }
    
    // Comparaison par coordonnées en fallback
    const coords1 = feature1.geometry?.coordinates;
    const coords2 = feature2.geometry?.coordinates;
    if (coords1 && coords2 && areCoordinatesIdentical(coords1, coords2)) {
        return true;
    }
    
    return false;
}

function showIdenticalPointsWarning() {
    alert('Les points A et B ne peuvent pas être identiques. Veuillez choisir une destination différente.');
}

function isPointBSelected() {
    // Vérifier si Point B est actuellement sélectionné
    const selectedPointB = document.getElementById('selected-point-b');
    const pointBSection = document.getElementById('point-b-section');
    
    return destinationCoords !== null && 
           selectedPointB && 
           selectedPointB.style.display !== 'none' &&
           pointBSection &&
           pointBSection.style.display !== 'none';
}

function getCurrentPointACoords() {
    // Obtenir les coordonnées réelles du Point A depuis l'affichage ou les variables
    const selectedPointA = document.getElementById('selected-point-a');
    if (selectedPointA && selectedPointA.style.display !== 'none') {
        // Si Point A est affiché, utiliser currentSearchCenter ou chercher dans les données
        return currentSearchCenter;
    }
    return null;
}

function getCurrentPointBCoords() {
    // Obtenir les coordonnées réelles du Point B depuis l'affichage ou les variables
    const selectedPointB = document.getElementById('selected-point-b');
    const pointBSection = document.getElementById('point-b-section');
    
    if (selectedPointB && selectedPointB.style.display !== 'none' &&
        pointBSection && pointBSection.style.display !== 'none') {
        return destinationCoords;
    }
    return null;
}

function showSinglePopup(properties, coordinates) {
    // Fermer tous les popups existants
    activePopups.forEach(p => p.remove());
    activePopups.length = 0;
    
    // Créer et afficher le nouveau popup
    const popup = createPopupContent(properties, coordinates);
    popup.setLngLat(coordinates).addTo(map);
    
    // Ajouter au tracking
    activePopups.push(popup);
    
    return popup;
}

// Fonction pour sélectionner une UP et afficher le rayon en mode normal
function selectUPAndShowRadius(feature) {
    const coordinates = feature.geometry.coordinates;
    
    // Définir le centre de recherche actuel
    currentSearchCenter = coordinates;
    
    // Stocker la feature pour persistance entre modes
    currentPointAFeature = feature;
    isPointAFromUP = true;
    
    // Afficher la sélection dans le geocoder normal si disponible
    if (window.normalGeocoder && feature.properties) {
        const upName = feature.properties.UP || feature.properties['Nom du site'] || '';
        const adresse = feature.properties.Adresse || feature.properties['Adresse'] || '';
        const ville = feature.properties.Ville || feature.properties['Ville'] || '';
        
        // Format avec emoji comme dans localUPGeocoder
        const displayName = `📍 ${upName}${adresse ? ', ' + adresse : ''}${ville ? ', ' + ville : ''}`;
        
        // Utiliser setInput sans déclencher de recherche
        const input = window.normalGeocoder._inputEl || window.normalGeocoder.container.querySelector('input');
        if (input) {
            input.value = displayName;
            // Fermer les suggestions s'il y en a
            window.normalGeocoder.clear();
            window.normalGeocoder._inputEl.value = displayName;
        }
    }
    
    // NE PAS marquer qu'on zoome vers cette UP car on ne fait PAS de vue 3D
    // zoomingToCoordinates = coordinates; // SUPPRIMÉ - c'était le bug !
    // currentView3DCoordinates = coordinates; // SUPPRIMÉ - on n'est pas en 3D !
    
    // Calculer le zoom pour voir tout le rayon (vue encore plus large)
    const radiusKm = currentSearchRadius || 80;
    let zoomLevel;
    if (radiusKm <= 20) zoomLevel = 9;
    else if (radiusKm <= 40) zoomLevel = 8.5;
    else if (radiusKm <= 60) zoomLevel = 8;
    else if (radiusKm <= 80) zoomLevel = 7.5;
    else if (radiusKm <= 100) zoomLevel = 7;
    else zoomLevel = 6.5;
    
    // Vérifier le zoom actuel
    const currentZoom = map.getZoom();
    console.log('SelectUPAndShowRadius appelé - Zoom actuel:', currentZoom, 'Zoom cible:', zoomLevel, 'Coordonnées:', coordinates);
    
    // Calculer la durée d'animation en fonction de l'écart de zoom
    const zoomDifference = Math.abs(currentZoom - zoomLevel);
    const animationDuration = zoomDifference > 3 ? 1000 : 800; // Plus long si grand écart
    
    // Forcer le centrage et zoom directement sans pré-dézoom
    setTimeout(() => {
        map.flyTo({
            center: coordinates,
            zoom: zoomLevel,
            duration: animationDuration,
            essential: true,
            curve: zoomDifference > 3 ? 1.5 : 1, // Courbe plus douce si grand écart
            easing: (t) => t // Linear easing pour plus de contrôle
        });
        console.log('FlyTo exécuté vers:', coordinates, 'avec zoom:', zoomLevel);
    }, 100);
    
    // Afficher le contrôle de rayon
    showRadiusControl();
    
    // Dessiner le cercle de rayon
    drawSearchRadiusCircle(coordinates, currentSearchRadius);
    
    // Attendre que le zoom soit terminé avant d'afficher le popup
    setTimeout(() => {
        showSinglePopup(feature.properties, coordinates);
        // Pas besoin de réinitialiser car on n'a jamais défini zoomingToCoordinates
    }, 1600);
    
    // Appliquer les filtres avec le nouveau centre
    applyFilters();
}

function focusOnEstablishment(feature) {
    const coordinates = feature.geometry.coordinates;
    
    // Vérifier si on est en mode normal - activer le rayon au lieu du zoom 3D
    if (window.currentAppMode === 'normal') {
        // Sélectionner l'UP et afficher le rayon (comme un double-clic sur la carte)
        selectUPAndShowRadius(feature);
        return;
    }
    
    // Mode itinéraire - comportement original
    // 🔍 ÉTAPE 1: Vérification anti-doublon robuste
    if (currentPointAFeature && areEstablishmentsIdentical(currentPointAFeature, feature)) {
        showIdenticalPointsWarning();
        return;
    }
    if (currentPointBFeature && areEstablishmentsIdentical(currentPointBFeature, feature)) {
        showIdenticalPointsWarning();
        return;
    }
    
    // [TARGET] ÉTAPE 2: Logique de sélection basée sur l'état actuel
    if (!currentPointAFeature) {
        // CAS 1: Aucun Point A → Sélectionner comme Point A
        selectAsPointA(feature);
        
    } else if (!currentPointBFeature) {
        // CAS 2: Point A existe, pas de Point B → Sélectionner comme Point B
        selectAsPointB(feature);
        
    } else {
        // CAS 3: A et B existent → Utiliser le focus pour déterminer lequel remplacer
        if (currentFocusedInput === 'A') {
            selectAsPointA(feature);
        } else {
            selectAsPointB(feature);
        }
    }
    
    // Suppression du zoom 3D - Simple sélection sans zoom
    // map.flyTo({ center: coordinates, zoom: 17, pitch: 60, bearing: 30, speed: 1.2, essential: true });
    
    // Utiliser showSinglePopup pour garantir qu'un seul popup soit visible
    showSinglePopup(feature.properties, coordinates);
}

function selectAsPointA(feature) {
    const coordinates = feature.geometry.coordinates;
    
    // Mettre à jour les variables globales
    currentSearchCenter = coordinates;
    currentPointAFeature = feature;
    isPointAFromUP = true; // Appelé depuis la carte = toujours une UP
    
    // Mettre à jour l'affichage
    updatePointADisplay(feature.properties);
    
    // Configuration de l'interface
    showPointB();
    setFocusOnPointB();
    showRadiusControl();
    showRouteInterface();
    
    // Configuration du rayon
    const radiusSlider = document.getElementById('radius-slider');
    if (radiusSlider) radiusSlider.value = 80;
    const radiusValue = document.getElementById('radius-value');
    if (radiusValue) radiusValue.textContent = "80 km";
    drawSearchRadiusCircle(currentSearchCenter, 80);
    applyFilters();
    
    // Mettre à jour la taille des pins sélectionnés
    updateSelectedPointsSize();
    
    // Centrer et zoomer sur le point sélectionné (même comportement qu'en mode carte)
    const radiusKm = currentSearchRadius || 80;
    let zoomLevel;
    if (radiusKm <= 20) zoomLevel = 9;
    else if (radiusKm <= 40) zoomLevel = 8.5;
    else if (radiusKm <= 60) zoomLevel = 8;
    else if (radiusKm <= 80) zoomLevel = 7.5;
    else if (radiusKm <= 100) zoomLevel = 7;
    else zoomLevel = 6.5;
    
    const currentZoom = map.getZoom();
    const zoomDifference = Math.abs(currentZoom - zoomLevel);
    const animationDuration = zoomDifference > 3 ? 1000 : 800;
    
    setTimeout(() => {
        map.flyTo({
            center: coordinates,
            zoom: zoomLevel,
            duration: animationDuration,
            essential: true,
            curve: zoomDifference > 3 ? 1.5 : 1,
            easing: (t) => t
        });
    }, 100);
    
    // Si Point B existe déjà, calculer l'itinéraire
    if (currentPointBFeature && destinationCoords) {
        setTimeout(() => {
            showRouteOnMap(currentSearchCenter, destinationCoords);
        }, 500);
    }
}

function selectAsPointB(feature) {
    const coordinates = feature.geometry.coordinates;
    
    // Mettre à jour les variables globales
    destinationCoords = coordinates;
    currentPointBFeature = feature;
    isPointBFromUP = true; // Appelé depuis la carte = toujours une UP
    
    // Mettre à jour l'affichage
    updatePointBDisplay(feature.properties);
    showPointB();
    
    // Mettre à jour la taille des pins sélectionnés
    updateSelectedPointsSize();
    
    // Centrer et zoomer sur le point sélectionné (même comportement qu'en mode carte)
    if (!currentPointAFeature) {
        // Seulement si Point A n'est pas défini
        const radiusKm = currentSearchRadius || 80;
        let zoomLevel;
        if (radiusKm <= 20) zoomLevel = 9;
        else if (radiusKm <= 40) zoomLevel = 8.5;
        else if (radiusKm <= 60) zoomLevel = 8;
        else if (radiusKm <= 80) zoomLevel = 7.5;
        else if (radiusKm <= 100) zoomLevel = 7;
        else zoomLevel = 6.5;
        
        const currentZoom = map.getZoom();
        const zoomDifference = Math.abs(currentZoom - zoomLevel);
        const animationDuration = zoomDifference > 3 ? 1000 : 800;
        
        setTimeout(() => {
            map.flyTo({
                center: coordinates,
                zoom: zoomLevel,
                duration: animationDuration,
                essential: true,
                curve: zoomDifference > 3 ? 1.5 : 1,
                easing: (t) => t
            });
        }, 100);
    }
    
    // Si Point A existe, vérifier qu'au moins un est une UP avant de calculer
    if (currentPointAFeature && currentSearchCenter) {
        if (!isPointAFromUP && !isPointBFromUP) {
            showCityToCityError();
            return;
        }
        setTimeout(() => {
            showRouteOnMap(currentSearchCenter, destinationCoords);
        }, 500);
    }
}

function updateSidebarBasedOnMapViewport() {
    if (!map.isStyleLoaded()) { 
        // Au lieu de retourner vide, essayer d'afficher avec les données disponibles
        if (!primaryFilteredFeatures) {
            primaryFilteredFeatures = [...establishmentsData.features];
        }
    }
    
    // Si primaryFilteredFeatures n'est pas encore défini, utiliser toutes les données
    if (!primaryFilteredFeatures) {
        primaryFilteredFeatures = [...establishmentsData.features];
    }
    
    let featuresToDisplay=[];
    
    if (currentLayoutMode==='sidebarFull') {
        // En mode sidebar complet, afficher tous les établissements filtrés
        featuresToDisplay=[...primaryFilteredFeatures];
    } else if (currentLayoutMode==='mapFull') {
        // En mode carte complet, ne rien afficher dans la sidebar
        featuresToDisplay=[];
    } else {
        // En mode dual, afficher SEULEMENT les établissements visibles sur la carte
        if (primaryFilteredFeatures.length > 0) {
            try {
                const mapBounds = map.getBounds();
                if (mapBounds) {
                    featuresToDisplay = primaryFilteredFeatures.filter(feature => {
                        if (!feature.geometry||!feature.geometry.coordinates) return false;
                        return mapBounds.contains(feature.geometry.coordinates);
                    });
                } else {
                    // Si getBounds() ne fonctionne pas, afficher tous les établissements
                    featuresToDisplay = [...primaryFilteredFeatures];
                }
            } catch (e) {
                // En cas d'erreur, afficher tous les établissements
                featuresToDisplay = [...primaryFilteredFeatures];
            }
        }
    }
    
    updateSidebarCards(featuresToDisplay);
    
    // Synchroniser les compteurs de la légende avec le viewport
    updateLegendCountsFromViewport();
}

function updateSidebarCards(features) {
    const sidebar = document.getElementById('establishments-view');
    
    // Effet de transition subtil
    sidebar.style.opacity = '0.7';
    setTimeout(() => {
        sidebar.innerHTML = '';
        
        if (features.length === 0) {
            const noResultsP = document.createElement('p');
            noResultsP.textContent = 'Aucun \u00E9tablissement trouv\u00E9 pour les crit\u00E8res s\u00E9lectionn\u00E9s ou dans la vue actuelle.';
            sidebar.appendChild(noResultsP);
            updateResultsCount(0);
            sidebar.style.opacity = '1';
            return;
        }

    // Trier par distance si on a un centre de recherche
    let sortedFeatures = [...features];
    if (currentSearchCenter && sortByDistance) {
        sortedFeatures.sort((a, b) => {
            const distanceA = getDistanceFromLatLonInKm(
                currentSearchCenter[1], currentSearchCenter[0],
                a.geometry.coordinates[1], a.geometry.coordinates[0]
            );
            const distanceB = getDistanceFromLatLonInKm(
                currentSearchCenter[1], currentSearchCenter[0],
                b.geometry.coordinates[1], b.geometry.coordinates[0]
            );
            return distanceA - distanceB;
        });
    }

    sortedFeatures.forEach(feature => {
        const card = document.createElement('div');
        card.className = 'establishment-card';
        
        // Ajouter l'attribut data-activity pour le style de bordure
        const activityType = getActivityType(feature.properties.activity);
        card.setAttribute('data-activity', activityType);
        
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `Établissement ${feature.properties.UP}`);
        
        const props = feature.properties;
        const name = decodeHTMLEntities(props.UP || 'N/A');
        const address = decodeHTMLEntities(props.Adresse || 'N/A');
        const city = decodeHTMLEntities(props.Ville || '');
        const postalCode = props["Code postal"] || '';
        const phone = props.Phone && props.Phone !== "null" ? props.Phone : null;
        const email = props.Email && props.Email !== "null" ? props.Email : null;

        // Calculer la distance et le temps de trajet
        let distanceHTML = '';
        if (currentSearchCenter) {
            let distance, travelTime;
            
            // Vérifier si c'est l'établissement de destination avec données réelles
            const isDestination = destinationCoords && 
                Math.abs(feature.geometry.coordinates[0] - destinationCoords[0]) < 0.0001 &&
                Math.abs(feature.geometry.coordinates[1] - destinationCoords[1]) < 0.0001;
            
            if (isDestination && realRouteData) {
                distance = parseFloat(realRouteData.distance);
                travelTime = realRouteData.travelTime;
            } else {
                distance = getDistanceFromLatLonInKm(
                    currentSearchCenter[1], currentSearchCenter[0],
                    feature.geometry.coordinates[1], feature.geometry.coordinates[0]
                );
                travelTime = calculateTravelTime(distance);
            }
            
            // Ne pas afficher les badges si distance = 0 ou temps = "0 min"
            const distanceValue = distance.toFixed ? distance.toFixed(1) : distance;
            if (parseFloat(distanceValue) > 0 && travelTime !== "0 min") {
                distanceHTML = `<span class="distance-badge">${distanceValue} km</span><span class="time-badge">${travelTime}</span>`;
            }
        }

        // Nouvelle structure compacte de la card
        
        // Header avec titre et badges sur la même ligne
        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        
        // Titre
        const title = document.createElement('h3');
        title.textContent = name;
        cardHeader.appendChild(title);
        
        // Badges de distance et temps (si disponibles)
        if (currentSearchCenter) {
            let distance, travelTime;
            
            // Vérifier si c'est l'établissement de destination avec données réelles
            const isDestination = destinationCoords && 
                Math.abs(feature.geometry.coordinates[0] - destinationCoords[0]) < 0.0001 &&
                Math.abs(feature.geometry.coordinates[1] - destinationCoords[1]) < 0.0001;
            
            if (isDestination && realRouteData) {
                distance = parseFloat(realRouteData.distance);
                travelTime = realRouteData.travelTime;
            } else {
                distance = getDistanceFromLatLonInKm(
                    currentSearchCenter[1], currentSearchCenter[0],
                    feature.geometry.coordinates[1], feature.geometry.coordinates[0]
                );
                travelTime = calculateTravelTime(distance);
            }
            
            // Arrondir la distance différemment selon la valeur
            let distanceDisplay;
            if (isDestination && realRouteData) {
                // Données réelles : affichage précis
                distanceDisplay = distance.toFixed(1) + ' km';
            } else {
                // Estimations : arrondir pour montrer l'approximation
                if (distance < 10) {
                    distanceDisplay = '~' + Math.round(distance) + ' km';
                } else if (distance < 50) {
                    distanceDisplay = '~' + (Math.round(distance / 5) * 5) + ' km';
                } else {
                    distanceDisplay = '~' + (Math.round(distance / 10) * 10) + ' km';
                }
            }
            
            if (distance > 0 && travelTime !== "0 min") {
                const badgesContainer = document.createElement('div');
                badgesContainer.className = 'card-badges';
                
                const distanceBadge = document.createElement('span');
                distanceBadge.className = 'distance-badge';
                distanceBadge.textContent = distanceDisplay;
                distanceBadge.title = (isDestination && realRouteData) ? 
                    'Distance réelle par la route' : 
                    'Distance approximative à vol d\'oiseau';
                badgesContainer.appendChild(distanceBadge);
                
                const timeBadge = document.createElement('span');
                timeBadge.className = 'time-badge';
                timeBadge.textContent = (isDestination && realRouteData) ? 
                    travelTime : 
                    travelTime;
                timeBadge.title = (isDestination && realRouteData) ? 
                    'Temps de trajet réel' : 
                    'Estimation du temps de trajet';
                badgesContainer.appendChild(timeBadge);
                
                cardHeader.appendChild(badgesContainer);
            }
        }
        
        card.appendChild(cardHeader);
        
        // Adresse (plus compacte)
        const addressEl = document.createElement('div');
        addressEl.className = 'card-address';
        addressEl.textContent = `${address}, ${city} ${postalCode}`;
        card.appendChild(addressEl);
        
        // Actions compactes avec icônes
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'card-actions-compact';
        
        // Bouton téléphone
        if (phone && phone !== "null") {
            const phoneBtn = document.createElement('button');
            phoneBtn.className = 'card-action-icon phone';
            phoneBtn.setAttribute('aria-label', 'Appeler');
            phoneBtn.setAttribute('title', 'Appeler');
            phoneBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>`;
            phoneBtn.onclick = (e) => {
                e.stopPropagation();
                window.location.href = `tel:${phone}`;
            };
            actionsContainer.appendChild(phoneBtn);
        }
        
        // Bouton itinéraire
        const routeBtn = document.createElement('button');
        routeBtn.className = 'card-action-icon route';
        routeBtn.setAttribute('aria-label', 'Itineraire');
        routeBtn.setAttribute('title', 'Itineraire');
        routeBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M21.71 11.29l-9-9a.996.996 0 00-1.41 0l-9 9a.996.996 0 000 1.41l9 9c.39.39 1.02.39 1.41 0l9-9a.996.996 0 000-1.41zM14 14.5V12h-4v3H8v-4c0-.55.45-1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>`;
        routeBtn.onclick = (e) => {
            e.stopPropagation();
            // Basculer en mode route si nécessaire
            if (window.switchToRouteMode) {
                window.switchToRouteMode();
            }
            // Sélectionner cette UP comme point A
            selectAsPointA(feature);
        };
        actionsContainer.appendChild(routeBtn);
        
        // Bouton info (remplace "Plus d'informations")
        const infoBtn = document.createElement('button');
        infoBtn.className = 'card-action-icon info';
        infoBtn.setAttribute('aria-label', 'Plus d\'informations');
        infoBtn.setAttribute('title', 'Plus d\'informations');
        infoBtn.setAttribute('data-feature', encodeURIComponent(JSON.stringify(props)));
        infoBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`;
        
        // Ajouter l'event listener pour le bouton info
        infoBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        
        actionsContainer.appendChild(infoBtn);
        
        // Bouton Voir en 3D / Retour à la carte
        const view3dBtn = document.createElement('button');
        
        // Vérifier si cette UP est actuellement en vue zoomée
        const currentZoom = map.getZoom();
        const currentPitch = map.getPitch();
        const mapCenter = map.getCenter();
        const centerDistance = turf.distance(
            turf.point([mapCenter.lng, mapCenter.lat]),
            turf.point(feature.geometry.coordinates),
            { units: 'kilometers' }
        );
        
        // On est en vue 3D uniquement si le pitch est élevé (> 45°)
        const isCurrently3D = (
            currentPitch > 45 && // DOIT avoir un pitch élevé pour être en 3D
            currentZoom >= 16 && // DOIT être zoomé
            centerDistance < 0.5 // DOIT être proche du centre
        );
        
        if (isCurrently3D) {
            // Mode retour à la carte
            view3dBtn.className = 'card-action-icon view3d active';
            view3dBtn.setAttribute('aria-label', 'Retour a la carte');
            view3dBtn.setAttribute('title', 'Retour a la carte');
            view3dBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M21 11l-6-6v5H8c-2.76 0-5 2.24-5 5v4h2v-4c0-1.65 1.35-3 3-3h7v5l6-6z"/></svg>`;
            
            view3dBtn.onclick = (e) => {
                e.stopPropagation();
                // Retour à la vue normale
                map.flyTo({
                    center: feature.geometry.coordinates,
                    zoom: 12,
                    pitch: 0,
                    bearing: 0,
                    speed: 1.2,
                    essential: true
                });
                // Réinitialiser les variables de tracking
                currentView3DCoordinates = null;
                zoomingToCoordinates = null;
                
                // Rafraîchir les cards après l'animation
                setTimeout(() => {
                    if (window.currentAppMode === 'normal') {
                        updateSidebarBasedOnMapViewport();
                    }
                }, 1300);
            };
        } else {
            // Mode voir en 3D
            view3dBtn.className = 'card-action-icon view3d';
            view3dBtn.setAttribute('aria-label', 'Voir en 3D');
            view3dBtn.setAttribute('title', 'Voir en 3D');
            view3dBtn.innerHTML = `<svg viewBox="0 0 24 24"><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="bold" fill="currentColor">3D</text></svg>`;
            
            view3dBtn.onclick = (e) => {
                e.stopPropagation();
                
                // Fonction pour effectuer le zoom 3D
                const doZoom3D = () => {
                    // Marquer qu'on est en train de zoomer vers cette UP
                    zoomingToCoordinates = feature.geometry.coordinates;
                    currentView3DCoordinates = feature.geometry.coordinates;
                    
                    // Zoom 3D sur l'établissement
                    map.flyTo({
                        center: feature.geometry.coordinates,
                        zoom: 17,
                        pitch: 60,
                        bearing: 30,
                        speed: 1.2,
                        essential: true
                    });
                    
                    // Rafraîchir les cards après l'animation
                    setTimeout(() => {
                        if (window.currentAppMode === 'normal') {
                            updateSidebarBasedOnMapViewport();
                        }
                    }, 1300);
                };
                
                // Si on est en mode liste, basculer vers la vue carte d'abord
                if (window.getCurrentLayoutMode && window.getCurrentLayoutMode() === 'sidebarFull') {
                    window.switchToMapFullScreen();
                    // Attendre que le changement de vue soit effectué
                    setTimeout(doZoom3D, 600);
                } else {
                    // Sinon, faire le zoom directement
                    doZoom3D();
                }
            };
        }
        
        actionsContainer.appendChild(view3dBtn);
        card.appendChild(actionsContainer);
        
        // Click handler pour la card entière (focus sur l'établissement ou modal)
        card.addEventListener('click', (event) => {
            if (!event.target.closest('.card-action-icon')) {
                // Vérifier si le modal est en train de se fermer
                if (window.modalClosing) {
                    return;
                }
                
                // En mode "Afficher la liste" uniquement, afficher le modal
                const mapContainer = document.getElementById('map-container');
                if (mapContainer && mapContainer.classList.contains('layout-sidebar-full')) {
                    // Vérifier si le modal est déjà ouvert
                    const modal = document.getElementById('modal');
                    if (modal && modal.style.display === 'block') {
                        return;
                    }
                    
                    // Simuler un clic sur le bouton "Plus d'infos"
                    const infoBtn = card.querySelector('.card-action-icon.info');
                    if (infoBtn) {
                        infoBtn.click();
                    }
                } else {
                    // Comportement normal : focus sur l'établissement
                    focusOnEstablishment(feature);
                }
            }
        });
        
        // Empêcher la propagation du clic sur les boutons d'action
        card.querySelectorAll('.card-action-icon').forEach(button => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
            });
        });
        
        sidebar.appendChild(card);
    });
    
    attachModalListeners();
    
    // Mettre à jour le compteur d'établissements visibles
    updateResultsCount(features.length);
    
    // Restaurer l'opacité après le rendu
    sidebar.style.opacity = '1';
    
    // Corriger les entités HTML dans les cards après leur création
    setTimeout(() => {
        fixCardEntities();
    }, 100);
    
    }, 50); // Délai court pour l'effet de transition
}

function updateResultsCount(visibleCount) {
    const resultsCountElement = document.getElementById('results-count');
    if (resultsCountElement) {
        let message = '';
        
        if (currentLayoutMode === 'sidebarFull') {
            // En mode sidebar complet, on affiche tous les établissements filtrés
            message = `${visibleCount} \u00E9tablissement(s) trouv\u00E9(s).`;
        } else if (currentLayoutMode === 'mapFull') {
            // En mode carte complet, pas de message dans la sidebar
            message = '';
        } else {
            // En mode dual, préciser "visibles" et donner le contexte
            const totalFiltered = primaryFilteredFeatures ? primaryFilteredFeatures.length : 0;
            if (visibleCount === 0) {
                message = `Aucun \u00E9tablissement visible dans cette zone.`;
                if (totalFiltered > 0) {
                    message += ` (${totalFiltered} au total)`;
                }
            } else if (visibleCount === totalFiltered) {
                message = `${visibleCount} \u00E9tablissement(s) trouv\u00E9(s).`;
            } else {
                message = `${visibleCount} visible(s) sur ${totalFiltered} trouv\u00E9(s).`;
            }
        }
        
        resultsCountElement.textContent = message;
    }
}

// Flag global pour empêcher la réouverture pendant la fermeture
window.modalClosing = false;

function closeModal() {
    // Marquer que le modal est en train de se fermer
    window.modalClosing = true;
    
    const modal = document.getElementById('modal');
    const modalContent = document.querySelector('.modal-content');
    
    // Fermeture immédiate sans animation pour éviter les conflits
    modal.style.display = 'none';
    
    // Bloquer toute réouverture pendant 500ms
    setTimeout(() => {
        window.modalClosing = false;
    }, 500);
}

function attachModalListeners() {
    // Nouvelle sélection pour les boutons info avec icônes
    document.querySelectorAll('#establishments-view .card-action-icon.info').forEach(button => {
        button.addEventListener('click', function(event) {
            event.preventDefault();
            // La propagation est déjà stoppée par un autre listener, mais on le laisse par sécurité
            event.stopPropagation();
            
            // Ne pas ouvrir si le modal est en train de se fermer
            if (window.modalClosing) {
                return;
            }
            
            const modal = document.getElementById('modal');
            const modalInfo = document.getElementById('modal-info');
            try {
                const props = JSON.parse(decodeURIComponent(this.dataset.feature));
                const name=decodeHTMLEntities(props.UP||'N/A');
                const address=decodeHTMLEntities(props.Adresse||'N/A');
                const city=decodeHTMLEntities(props.Ville||'');
                const postalCode=props["Code postal"]||'';
                const phone=props.Phone&&props.Phone!=="null"?decodeHTMLEntities(props.Phone):null;
                const email=props.Email&&props.Email!=="null"?decodeHTMLEntities(props.Email):null;
                const activity=props.activity?decodeHTMLEntities(props.activity.charAt(0).toUpperCase()+props.activity.slice(1)):'N/A';
                
                // Créer le contenu moderne de la modal
                const modalContent = document.querySelector('.modal-content');
                modalContent.innerHTML = '';
                
                // Header
                const modalHeader = document.createElement('div');
                modalHeader.className = 'modal-header';
                const modalTitle = document.createElement('h3');
                modalTitle.textContent = name;
                modalHeader.appendChild(modalTitle);
                
                const closeBtn = document.createElement('span');
                closeBtn.className = 'close-button';
                closeBtn.innerHTML = '×';
                modalHeader.appendChild(closeBtn);
                
                modalContent.appendChild(modalHeader);
                
                // Body
                const modalBody = document.createElement('div');
                modalBody.className = 'modal-body';
                
                // Adresse
                const addressRow = document.createElement('div');
                addressRow.className = 'modal-info-row';
                const addressLabel = document.createElement('div');
                addressLabel.className = 'modal-info-label';
                addressLabel.textContent = 'Adresse';
                const addressValue = document.createElement('div');
                addressValue.className = 'modal-info-value';
                addressValue.innerHTML = `${address}<br>${city} ${postalCode}`;
                addressRow.appendChild(addressLabel);
                addressRow.appendChild(addressValue);
                modalBody.appendChild(addressRow);
                
                // Téléphone
                const phoneRow = document.createElement('div');
                phoneRow.className = 'modal-info-row';
                const phoneLabel = document.createElement('div');
                phoneLabel.className = 'modal-info-label';
                phoneLabel.textContent = 'T\u00E9l\u00E9phone';
                const phoneValue = document.createElement('div');
                phoneValue.className = 'modal-info-value';
                if (phone) {
                    const phoneLink = document.createElement('a');
                    phoneLink.href = `tel:${phone}`;
                    phoneLink.textContent = phone;
                    phoneValue.appendChild(phoneLink);
                } else {
                    phoneValue.textContent = 'Non disponible';
                }
                phoneRow.appendChild(phoneLabel);
                phoneRow.appendChild(phoneValue);
                modalBody.appendChild(phoneRow);
                
                // Email
                const emailRow = document.createElement('div');
                emailRow.className = 'modal-info-row';
                const emailLabel = document.createElement('div');
                emailLabel.className = 'modal-info-label';
                emailLabel.textContent = 'Email';
                const emailValue = document.createElement('div');
                emailValue.className = 'modal-info-value';
                if (email) {
                    const emailLink = document.createElement('a');
                    emailLink.href = `mailto:${email}`;
                    emailLink.textContent = email;
                    emailValue.appendChild(emailLink);
                } else {
                    emailValue.textContent = 'Non disponible';
                }
                emailRow.appendChild(emailLabel);
                emailRow.appendChild(emailValue);
                modalBody.appendChild(emailRow);
                
                // Activité
                const activityRow = document.createElement('div');
                activityRow.className = 'modal-info-row';
                const activityLabel = document.createElement('div');
                activityLabel.className = 'modal-info-label';
                activityLabel.textContent = 'Activit\u00E9';
                const activityValue = document.createElement('div');
                activityValue.className = 'modal-info-value';
                const activityBadge = document.createElement('span');
                activityBadge.className = 'activity-badge';
                activityBadge.textContent = activity;
                activityValue.appendChild(activityBadge);
                activityRow.appendChild(activityLabel);
                activityRow.appendChild(activityValue);
                modalBody.appendChild(activityRow);
                
                modalContent.appendChild(modalBody);
                
                // Footer avec actions
                const modalFooter = document.createElement('div');
                modalFooter.className = 'modal-footer';
                
                if (phone) {
                    const callBtn = document.createElement('button');
                    callBtn.className = 'modal-action-btn primary';
                    callBtn.innerHTML = '📞 Appeler';
                    callBtn.onclick = () => window.location.href = `tel:${phone}`;
                    modalFooter.appendChild(callBtn);
                }
                
                const closeActionBtn = document.createElement('button');
                closeActionBtn.className = 'modal-action-btn secondary';
                closeActionBtn.textContent = 'Fermer';
                closeActionBtn.onclick = (e) => {
                    e.stopPropagation();
                    closeModal();
                };
                modalFooter.appendChild(closeActionBtn);
                
                modalContent.appendChild(modalFooter);
            } catch (e) {
                modalInfo.innerHTML = '';
                const errorP = document.createElement('p');
                errorP.textContent = "Impossible d'afficher les informations.";
                modalInfo.appendChild(errorP);
            }
            // Afficher la modal avec animations
            modal.style.display = 'block';
            modal.style.animation = 'fadeIn 0.3s ease';
            const modalContent = document.querySelector('.modal-content');
            if (modalContent) {
                modalContent.style.animation = 'slideUp 0.3s ease';
            }
            // Corriger les entités HTML dans la modal
            setTimeout(fixCardEntities, 100);
        });
    });
}

function drawSearchRadiusCircle(center, radiusKm) {
    removeSearchRadiusCircle();
    if (!turf) return;
    try {
        const circleGeoJSON = turf.circle(center, radiusKm, { steps: 64, units: 'kilometers' });
        if (map.getSource('radius-circle-source')) {
            map.getSource('radius-circle-source').setData(circleGeoJSON);
        } else {
            map.addSource('radius-circle-source', { type: 'geojson', data: circleGeoJSON });
            // Ajouter le layer du cercle
            // Important: Ne PAS spécifier de beforeId pour éviter les conflits avec l'ordre des layers
            map.addLayer({ 
                id: 'radius-circle-layer', 
                type: 'line', 
                source: 'radius-circle-source', 
                layout: {}, 
                paint: { 
                    'line-color': '#555', 
                    'line-width': 2, 
                    'line-dasharray': [2, 2] 
                } 
            });
            
            // Déplacer le layer du cercle en dessous des points après l'avoir ajouté
            if (map.getLayer('unclustered-point')) {
                map.moveLayer('radius-circle-layer', 'unclustered-point');
            }
            if (map.getLayer('clusters')) {
                map.moveLayer('radius-circle-layer', 'clusters');
            }
        }
    } catch (e) { console.error("Erreur lors de la création du cercle:", e); }
}

function removeSearchRadiusCircle() {
    if (map.getLayer('radius-circle-layer')) map.removeLayer('radius-circle-layer');
    if (map.getSource('radius-circle-source')) map.removeSource('radius-circle-source');
}

// Fonction simplifiée pour nettoyer les anciens marqueurs/popups si nécessaire
function cleanupOldMarkers() {
    currentMapboxMarkers.forEach(marker => marker.remove());
    currentMapboxMarkers.length = 0;
    activePopups.forEach(popup => popup.remove());
    activePopups.length = 0;
    // Mettre à jour la légende
    setTimeout(() => updateLegendCountsFromViewport(), 100);
}

function initializeLayout(){
    // Le bouton view-switcher a été supprimé, on garde juste la vérification du layout
    checkAndSetLayout();
}

function checkAndSetLayout(){
    const isBelowThreshold=window.innerHeight<VIEW_MODE_THRESHOLD;
    if(isBelowThreshold){
        // En mobile, pas de vue duale
        if(currentLayoutMode==='dual'){ switchToSidebarFullScreen(); }
    }else{
        // En desktop, la vue duale est permise
        if(currentLayoutMode!=='dual'){ switchToDualView(); }
    }
    setTimeout(()=>{if(map)map.resize();},550);
}

function switchToSidebarFullScreen(){
    const mapContainer=document.getElementById('map-container');
    mapContainer.className='layout-sidebar-full';
    currentLayoutMode='sidebarFull';
    // Mettre à jour l'icône du bouton toggle - on est en vue liste, afficher l'icône carte
    const toggleIcon = document.getElementById('mobile-toggle-icon');
    if (toggleIcon) {
        toggleIcon.setAttribute('d', 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z');
    }
    
    // Supprimer le bouton de réinitialisation
    removeResetButton();
    
    setTimeout(()=>{if(map){map.resize();updateSidebarBasedOnMapViewport();}},550);
}

function switchToMapFullScreen(){
    const mapContainer=document.getElementById('map-container');
    mapContainer.className='layout-map-full';
    currentLayoutMode='mapFull';
    // Mettre à jour l'icône du bouton toggle - on est en vue carte, afficher l'icône liste
    const toggleIcon = document.getElementById('mobile-toggle-icon');
    if (toggleIcon) {
        toggleIcon.setAttribute('d', 'M3 4h18v2H3V4zm0 7h18v2H3v-2zm0 7h18v2H3v-2z');
    }
    
    // Créer et afficher le bouton de réinitialisation
    createResetButton();
    
    setTimeout(()=>{if(map){map.resize();updateSidebarBasedOnMapViewport();}},550);
}

// Exposer les fonctions et variables dans le scope global pour l'iframe
window.switchToMapFullScreen = switchToMapFullScreen;
window.getCurrentLayoutMode = () => currentLayoutMode;

function switchToDualView(){
    const mapContainer=document.getElementById('map-container');
    mapContainer.className='layout-dual';
    currentLayoutMode='dual';
    // Mettre à jour l'icône du bouton toggle - on est en vue duale, afficher l'icône grille
    const toggleIcon = document.getElementById('mobile-toggle-icon');
    if (toggleIcon) {
        toggleIcon.setAttribute('d', 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z');
    }
    
    // Supprimer le bouton de réinitialisation
    removeResetButton();
    
    setTimeout(()=>{if(map){map.resize();updateSidebarBasedOnMapViewport();}},550);
}

// Fonction pour créer le bouton de réinitialisation
function createResetButton() {
    // Vérifier si le bouton existe déjà
    if (document.getElementById('map-reset-btn')) {
        return;
    }
    
    const mapElement = document.getElementById('map');
    if (!mapElement) return;
    
    // Créer le bouton
    const resetBtn = document.createElement('button');
    resetBtn.id = 'map-reset-btn';
    resetBtn.className = 'map-reset-btn';
    resetBtn.setAttribute('aria-label', 'Reinitialiser');
    resetBtn.setAttribute('title', 'Reinitialiser');
    resetBtn.style.display = 'flex';
    
    // Créer l'icône SVG
    resetBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
    `;
    
    // Ajouter l'event listener
    resetBtn.addEventListener('click', resetMap);
    
    // Ajouter le bouton au map
    mapElement.appendChild(resetBtn);
}

// Fonction pour supprimer le bouton de réinitialisation
function removeResetButton() {
    const resetBtn = document.getElementById('map-reset-btn');
    if (resetBtn) {
        resetBtn.remove();
    }
}

// Fonction pour décoder les entités HTML et forcer Unicode
function decodeHTMLEntities(text) {
    if (!text) return text;
    
    // Remplacer les entités HTML communes par leur équivalent Unicode
    text = text.toString()
	.replace(/é/gi, '\u00E9')
	.replace(/è/gi, '\u00E8')
	.replace(/ê/gi, '\u00EA')
	.replace(/à/gi, '\u00E0')
	.replace(/â/gi, '\u00E2')
	.replace(/ô/gi, '\u00F4')
	.replace(/ù/gi, '\u00F9')
	.replace(/û/gi, '\u00FB')
	.replace(/ï/gi, '\u00EF')
	.replace(/ö/gi, '\u00F6')
	.replace(/ç/gi, '\u00E7')
	.replace(/É/gi, '\u00C9')
	.replace(/È/gi, '\u00C8')
	.replace(/À/gi, '\u00C0')
	.replace(/&amp;/gi, '&')
	.replace(/&lt;/gi, '<')
	.replace(/&gt;/gi, '>')
	.replace(/&quot;/gi, '"')
	.replace(/&#39;/gi, "'")
	.replace(/&nbsp;/gi, ' ');
        
    // Utiliser également la méthode textarea pour les autres entités
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
}

// Solution: Utiliser des caractères Unicode directement pour éviter la transformation par Drupal
function safeText(text) {
    // Si on est dans un iframe, utiliser des caractères Unicode échappés
    if (window.self !== window.top) {
        return text
            .replace(/é/g, '\u00E9')
            .replace(/É/g, '\u00C9')
            .replace(/è/g, '\u00E8')
            .replace(/È/g, '\u00C8')
            .replace(/à/g, '\u00E0')
            .replace(/À/g, '\u00C0')
            .replace(/ù/g, '\u00F9')
            .replace(/Ù/g, '\u00D9')
            .replace(/ô/g, '\u00F4')
            .replace(/Ô/g, '\u00D4')
            .replace(/ç/g, '\u00E7')
            .replace(/Ç/g, '\u00C7')
            .replace(/â/g, '\u00E2')
            .replace(/Â/g, '\u00C2')
            .replace(/ê/g, '\u00EA')
            .replace(/Ê/g, '\u00CA')
            .replace(/î/g, '\u00EE')
            .replace(/Î/g, '\u00CE')
            .replace(/û/g, '\u00FB')
            .replace(/Û/g, '\u00DB')
            .replace(/ï/g, '\u00EF')
            .replace(/Ï/g, '\u00CF')
            .replace(/ë/g, '\u00EB')
            .replace(/Ë/g, '\u00CB')
            .replace(/•/g, '\u2022');
    }
    return text;
}

// Alternative: Créer des text nodes avec createTextNode qui échappe au traitement HTML
function createSafeTextNode(text) {
    // Créer un noeud texte qui ne sera pas interprété comme HTML
    const textNode = document.createTextNode(text);
    return textNode;
}

// Fonction pour corriger les entités HTML dans les cards et modals
function fixCardEntities() {
    const entityMap = {
        'é': 'é', 'É': 'É',
        'è': 'è', 'È': 'È',
        'à': 'à', 'À': 'À',
        'ù': 'ù', 'Ù': 'Ù',
        'ô': 'ô', 'Ô': 'Ô',
        'ç': 'ç', 'Ç': 'Ç',
        'â': 'â', 'Â': 'Â',
        'ê': 'ê', 'Ê': 'Ê',
        'î': 'î', 'Î': 'Î',
        'û': 'û', 'Û': 'Û',
        'ü': 'ü', 'Ü': 'Ü',
        ' ': ' ', '•': '•',
        'é': 'é', 'É': 'É',
        'è': 'è', 'È': 'È',
        'à': 'à', 'À': 'À'
    };
    
    const fixText = (text) => {
        if (!text) return text;
        let fixed = text;
        for (const [entity, char] of Object.entries(entityMap)) {
            fixed = fixed.replace(new RegExp(entity, 'gi'), char);
        }
        return fixed;
    };
    
    // Corriger toutes les cards
    document.querySelectorAll('.establishment-card').forEach(card => {
        // Parcourir tous les nœuds de texte dans la card
        const walker = document.createTreeWalker(
            card,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let node;
        while (node = walker.nextNode()) {
            if (node.nodeValue && node.nodeValue.includes('&')) {
                node.nodeValue = fixText(node.nodeValue);
            }
        }
    });
    
    // Corriger la modal si elle est ouverte
    const modalInfo = document.getElementById('modal-info');
    if (modalInfo && modalInfo.innerHTML) {
        const walker = document.createTreeWalker(
            modalInfo,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let node;
        while (node = walker.nextNode()) {
            if (node.nodeValue && node.nodeValue.includes('&')) {
                node.nodeValue = fixText(node.nodeValue);
            }
        }
    }
    
    // Corriger les popups Mapbox
    document.querySelectorAll('.mapboxgl-popup-content').forEach(popup => {
        const walker = document.createTreeWalker(
            popup,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let node;
        while (node = walker.nextNode()) {
            if (node.nodeValue && node.nodeValue.includes('&')) {
                node.nodeValue = fixText(node.nodeValue);
            }
        }
    });
}

// Fonction pour surveiller et corriger les cards
function setupCardEntityFix() {
    // Observer uniquement les changements dans le container des cards
    const establishmentsView = document.getElementById('establishments-view');
    const modalContainer = document.getElementById('modal');
    
    if (establishmentsView) {
        const observer = new MutationObserver((mutations) => {
            // Vérifier si des cards ont été ajoutées
            let hasNewCards = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE && 
                            (node.classList && node.classList.contains('establishment-card') ||
                             node.querySelector && node.querySelector('.establishment-card'))) {
                            hasNewCards = true;
                            break;
                        }
                    }
                }
            }
            
            if (hasNewCards) {
                // Corriger après un court délai pour laisser Drupal faire sa transformation
                setTimeout(fixCardEntities, 100);
                setTimeout(fixCardEntities, 500);
                setTimeout(fixCardEntities, 1000);
            }
        });
        
        observer.observe(establishmentsView, {
            childList: true,
            subtree: false
        });
    }
    
    // Observer aussi la modal
    if (modalContainer) {
        const modalObserver = new MutationObserver(() => {
            if (modalContainer.style.display === 'block') {
                setTimeout(fixCardEntities, 100);
            }
        });
        
        modalObserver.observe(modalContainer, {
            attributes: true,
            attributeFilter: ['style']
        });
    }
    
    // Correction initiale après un délai
    setTimeout(fixCardEntities, 1500);
    setTimeout(fixCardEntities, 3000);
}

// Détection si on est dans un iframe
function isInIframe() {
    try {
        return window.self !== window.top;
    } catch (e) {
        return true;
    }
}

// Ajuster les styles si on est dans un iframe
if (isInIframe()) {
    // Fonction pour nettoyer les entités HTML dans tout le DOM
    function cleanHTMLEntities() {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let node;
        while (node = walker.nextNode()) {
            if (node.nodeValue && node.nodeValue.includes('&')) {
                node.nodeValue = decodeHTMLEntities(node.nodeValue);
            }
        }
    }
    
    // Nettoyer périodiquement les entités HTML
    setInterval(cleanHTMLEntities, 500);
    
    // Forcer le container à ne pas dépasser - limiter à 95vw
    const style = document.createElement('style');
    style.textContent = `
        * {
            box-sizing: border-box !important;
        }
        body, html {
            width: 95vw !important;
            max-width: 95vw !important;
            height: 85vh !important;
            max-height: 85vh !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
        }
        #map-container {
            width: 95vw !important;
            max-width: 95vw !important;
            height: 85vh !important;
            max-height: 85vh !important;
            position: relative !important;
            margin: 0 auto !important;
        }
        #map-container.layout-sidebar-full {
            display: block !important;
            width: 95vw !important;
            max-width: 95vw !important;
            height: 85vh !important;
            max-height: 85vh !important;
        }
        #map-container.layout-sidebar-full #sidebar {
            width: 95vw !important;
            max-width: 95vw !important;
            height: 85vh !important;
            max-height: 85vh !important;
            min-width: 0 !important;
            padding: 10px !important;
            position: relative !important;
            transform: none !important;
            margin: 0 !important;
        }
        #map-container.layout-map-full {
            height: 85vh !important;
            max-height: 85vh !important;
        }
        #map {
            height: 85vh !important;
            max-height: 85vh !important;
        }
        #map-container.layout-sidebar-full #establishments-view {
            width: calc(95vw - 40px) !important;
            max-width: calc(95vw - 40px) !important;
            overflow-x: hidden !important;
            margin: 0 !important;
            padding: 0 10px !important;
        }
        #map-container.layout-sidebar-full .establishment-card {
            width: calc(100% - 10px) !important;
            max-width: calc(100% - 10px) !important;
            margin: 5px !important;
        }
        .mobile-toggle-btn {
            right: 15px !important;
            position: fixed !important;
        }
        /* Forcer la barre de recherche à ne pas dépasser */
        .mapboxgl-ctrl-geocoder {
            max-width: calc(95vw - 100px) !important;
        }
        .search-and-reset-container {
            max-width: calc(95vw - 40px) !important;
            overflow: hidden !important;
        }
        /* Empêcher tout dépassement */
        #map-container * {
            max-width: 95vw !important;
        }
        /* Ajuster le modal dans l'iframe */
        .modal-content {
            margin: 5vh auto !important;
            max-height: 75vh !important;
            overflow-y: auto !important;
        }
    `;
    document.head.appendChild(style);
    
    // Script de diagnostic et correction automatique
    function fixOverflow() {
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const elements = document.querySelectorAll('*');
        
        elements.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.right > viewportWidth) {
                console.warn('Element overflowing:', el, 'Width:', rect.width, 'Right:', rect.right);
                el.style.maxWidth = '100%';
                el.style.width = '100%';
                el.style.boxSizing = 'border-box';
            }
        });
    }
    
    // Exécuter la correction après le chargement et lors du redimensionnement
    window.addEventListener('load', fixOverflow);
    window.addEventListener('resize', fixOverflow);
    setTimeout(fixOverflow, 1000);
    setTimeout(fixOverflow, 3000);
}

// Démarrage de l'application
document.addEventListener('DOMContentLoaded', function() {
    initializeMap();
    initializeSearchAndFilters();
    initializeMobileToggle();
    initializeKeyboardNavigation();
    initializeModeSwitcher();
    
    // Configurer la correction des entités HTML pour les cards
    setupCardEntityFix();
    
    // Gérer le clic en dehors de la modal ou sur la croix pour la fermer
    window.addEventListener('click', function(event) {
        const modal = document.getElementById('modal');
        // Fermer si on clique en dehors OU sur la croix
        if (event.target === modal || event.target.classList.contains('close-button')) {
            closeModal();
        }
    });
    
    // Corriger spécifiquement le bouton reset si nécessaire
    const resetButton = document.getElementById('reset-map');
    if (resetButton && resetButton.textContent.includes('\\u')) {
        resetButton.textContent = 'Réinitialiser la carte';
    }
    
    // Corriger si Drupal transforme en entités HTML
    setTimeout(() => {
        const resetBtn = document.getElementById('reset-map');
        if (resetBtn && (resetBtn.textContent.includes('&') || resetBtn.textContent.includes('\\u'))) {
            resetBtn.textContent = 'Réinitialiser la carte';
        }
    }, 1000);
    
    // Auto-géolocalisation si paramètre URL ?autogeo=true ou variable globale
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('autogeo') === 'true' || window.VICAT_MAP_AUTOGEO === true) {
        // Attendre que la carte soit chargée puis afficher l'overlay
        setTimeout(() => {
            showGeolocationOverlay();
        }, 1500);
    }
});

// Afficher un overlay pour demander la géolocalisation (nécessite une action utilisateur)
function showGeolocationOverlay() {
    // Créer l'overlay
    const overlay = document.createElement('div');
    overlay.id = 'geolocation-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 32, 96, 0.9);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.3s ease;
    `;
    
    overlay.innerHTML = `
        <div style="text-align: center; color: white; padding: 40px; max-width: 500px;">
            <div style="font-size: 64px; margin-bottom: 20px;">📍</div>
            <h2 style="font-size: 24px; margin-bottom: 15px; font-weight: 600;">
                Trouvez les centrales à béton près de chez vous
            </h2>
            <p style="font-size: 16px; margin-bottom: 30px; opacity: 0.9;">
                Autorisez la géolocalisation pour afficher les établissements Vicat dans un rayon de 80 km autour de votre position.
            </p>
            <button id="geoloc-accept-btn" style="
                background: white;
                color: #002060;
                border: none;
                padding: 15px 40px;
                font-size: 16px;
                font-weight: 600;
                border-radius: 8px;
                cursor: pointer;
                margin-right: 10px;
                transition: transform 0.2s, box-shadow 0.2s;
            ">
                🎯 Me localiser
            </button>
            <button id="geoloc-skip-btn" style="
                background: transparent;
                color: white;
                border: 2px solid white;
                padding: 15px 30px;
                font-size: 16px;
                font-weight: 600;
                border-radius: 8px;
                cursor: pointer;
                transition: background 0.2s;
            ">
                Voir toute la carte
            </button>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Bouton accepter - déclenche la géolocalisation
    document.getElementById('geoloc-accept-btn').addEventListener('click', function() {
        triggerAutoGeolocation();
        overlay.remove();
    });
    
    // Bouton ignorer - ferme l'overlay
    document.getElementById('geoloc-skip-btn').addEventListener('click', function() {
        overlay.remove();
    });
}

// Fonction globale pour déclencher la géolocalisation (doit être appelée suite à une action utilisateur)
function triggerAutoGeolocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            position => {
                currentSearchCenter = [position.coords.longitude, position.coords.latitude];
                if (geocoder) geocoder.setInput('Ma position actuelle');
                
                // Afficher le contrôle de rayon et définir à 80 km
                if (typeof showRadiusControl === 'function') showRadiusControl();
                currentSearchRadius = 80;
                const radiusSlider = document.getElementById('radius-slider');
                if (radiusSlider) radiusSlider.value = 80;
                const radiusValue = document.getElementById('radius-value');
                if (radiusValue) radiusValue.textContent = "80 km";
                
                // Dessiner le cercle de 80 km
                if (typeof drawSearchRadiusCircle === 'function') {
                    drawSearchRadiusCircle(currentSearchCenter, 80);
                }
                
                // Zoomer pour voir tout le rayon
                if (map) map.flyTo({ center: currentSearchCenter, zoom: 9.5, duration: 1500 });
                
                if (typeof showRouteInterface === 'function') showRouteInterface();
                if (typeof applyFilters === 'function') applyFilters();
            },
            error => {
                alert("Impossible d'accéder à votre position. Vérifiez que la géolocalisation est activée dans votre navigateur.");
                console.warn("Géolocalisation impossible:", error.message);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
        );
    } else {
        alert("La géolocalisation n'est pas supportée par votre navigateur.");
    }
}

// Exposer la fonction globalement
window.triggerAutoGeolocation = triggerAutoGeolocation;
window.showGeolocationOverlay = showGeolocationOverlay;

function initializeSearchAndFilters() {
    
}

function initializeMobileToggle() {
    const mobileToggle = document.getElementById('mobile-toggle');
    const mapContainer = document.getElementById('map-container');
    
    function checkMobile() {
        // Toujours afficher le switcher
        mobileToggle.style.display = 'flex';
    }
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    mobileToggle.addEventListener('click', () => {
        // Basculer entre les vues
        if (currentLayoutMode === 'mapFull') {
            switchToSidebarFullScreen();
            // On est maintenant en vue liste, afficher l'icône carte (destination)
            document.getElementById('mobile-toggle-icon').setAttribute('d', 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z');
        } else if (currentLayoutMode === 'sidebarFull') {
            switchToMapFullScreen();
            // On est maintenant en vue carte, afficher l'icône liste (destination)
            document.getElementById('mobile-toggle-icon').setAttribute('d', 'M3 4h18v2H3V4zm0 7h18v2H3v-2zm0 7h18v2H3v-2z');
        } else {
            // Si on est en vue duale, aller vers la carte
            switchToMapFullScreen();
            document.getElementById('mobile-toggle-icon').setAttribute('d', 'M3 4h18v2H3V4zm0 7h18v2H3v-2zm0 7h18v2H3v-2z');
        }
    });
}

function initializeKeyboardNavigation() {
    // Navigation au clavier dans la liste d'établissements
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            // Fermer les popups
            activePopups.forEach(p => p.remove());
            activePopups.length = 0;
            
            // Fermer la modal si elle est ouverte
            const modal = document.getElementById('modal');
            if (modal && modal.style.display === 'block') {
                closeModal();
            }
        }
    });
}

// Fonction globale pour changer de mode (utilisée par le switcher sur la carte)
function switchMode(mode) {
    const modeNormalBtn = document.getElementById('mode-normal');
    const modeRouteBtn = document.getElementById('mode-route');
    
    if (mode === 'normal') {
        if (window.switchToNormalMode) window.switchToNormalMode();
        if (modeNormalBtn) modeNormalBtn.classList.add('active');
        if (modeRouteBtn) modeRouteBtn.classList.remove('active');
    } else if (mode === 'route') {
        if (window.switchToRouteMode) window.switchToRouteMode();
        if (modeNormalBtn) modeNormalBtn.classList.remove('active');
        if (modeRouteBtn) modeRouteBtn.classList.add('active');
    }
}

// Initialisation du mode switcher
function initializeModeSwitcher() {
    const modeNormalBtn = document.getElementById('mode-normal');
    const modeRouteBtn = document.getElementById('mode-route');
    const normalInterface = document.getElementById('normal-mode-interface');
    const routeInterface = document.getElementById('route-mode-interface');
    
    // Exposer le mode actuel globalement pour que d'autres fonctions puissent le vérifier
    window.currentAppMode = 'normal';
    let normalGeocoder = null;
    // Rendre normalGeocoder accessible globalement
    window.normalGeocoder = null;

    // Fonction pour basculer vers le mode normal (exposée globalement)
    window.switchToNormalMode = function() {
        window.currentAppMode = 'normal';
        
        // Mise à jour des boutons
        modeNormalBtn.classList.add('active');
        modeRouteBtn.classList.remove('active');
        
        // Afficher/Masquer les interfaces
        normalInterface.style.display = 'block';
        routeInterface.style.display = 'none';
        
        // Masquer le bouton d'ajout de destination
        const addDestBtn = document.getElementById('add-destination-btn');
        if (addDestBtn) addDestBtn.style.display = 'none';
        
        // Masquer la section point B si elle était visible
        const pointBSection = document.getElementById('point-b-section');
        if (pointBSection) pointBSection.style.display = 'none';
        
        // Effacer les routes si elles existent
        clearRoute();
        
        // Transférer la sélection du Point A vers le geocoder normal si elle existe
        if (currentSearchCenter && normalGeocoder) {
            // Si c'était une UP, afficher son nom
            if (currentPointAFeature && currentPointAFeature.properties) {
                const props = currentPointAFeature.properties;
                const upName = props.UP || props['Nom du site'] || '';
                if (upName) {
                    const adresse = props.Adresse || props['Adresse'] || '';
                    const ville = props.Ville || props['Ville'] || '';
                    const displayName = `📍 ${upName}${adresse ? ', ' + adresse : ''}${ville ? ', ' + ville : ''}`;
                    
                    // Définir directement la valeur sans déclencher de recherche
                    const input = normalGeocoder._inputEl || normalGeocoder.container.querySelector('input');
                    if (input) {
                        input.value = displayName;
                    }
                }
            } else if (currentPointAFeature && currentPointAFeature.place_name) {
                // Si c'était une ville
                const input = normalGeocoder._inputEl || normalGeocoder.container.querySelector('input');
                if (input) {
                    input.value = currentPointAFeature.place_name || currentPointAFeature.text;
                }
            }
        }
        
        // Réinitialiser les sélections d'itinéraire
        clearRoutePoints();
        
        // Rafraîchir les cards pour mettre à jour le style de curseur
        updateSidebarBasedOnMapViewport();
    }

    // Fonction pour basculer vers le mode itinéraire (exposée globalement)
    window.switchToRouteMode = function() {
        window.currentAppMode = 'route';
        
        // Mise à jour des boutons
        modeNormalBtn.classList.remove('active');
        modeRouteBtn.classList.add('active');
        
        // Afficher/Masquer les interfaces
        normalInterface.style.display = 'none';
        routeInterface.style.display = 'block';
        
        // Afficher le bouton d'ajout de destination en mode route
        const addDestBtn = document.getElementById('add-destination-btn');
        if (addDestBtn) addDestBtn.style.display = 'block';
        
        // Transférer la sélection actuelle vers le Point A si elle existe
        if (currentSearchCenter && !currentPointAFeature) {
            // Si on a une sélection mais pas encore de Point A dans le mode route
            showRouteInterface();
            showPointB();
        } else if (currentPointAFeature) {
            // Si on a déjà un Point A, l'afficher
            showRouteInterface();
            showPointB();
            updatePointADisplay(currentPointAFeature.properties || {});
        }
        
        // Rafraîchir les cards pour mettre à jour le style de curseur
        updateSidebarBasedOnMapViewport();
    }

    // Fonction pour effacer les points de route
    function clearRoutePoints() {
        // Réinitialiser point A
        const selectedPointA = document.getElementById('selected-point-a');
        const pointAName = document.getElementById('point-a-name');
        if (selectedPointA) selectedPointA.style.display = 'none';
        if (pointAName) pointAName.textContent = '';
        if (window.pointAData) window.pointAData = null;
        
        // Réinitialiser point B
        const selectedPointB = document.getElementById('selected-point-b');
        const pointBName = document.getElementById('point-b-name');
        if (selectedPointB) selectedPointB.style.display = 'none';
        if (pointBName) pointBName.textContent = '';
        if (window.pointBData) window.pointBData = null;
    }

    // Fonction pour effacer la route de la carte
    function clearRoute() {
        if (map && map.getSource('route')) {
            if (map.getLayer('route')) {
                map.removeLayer('route');
            }
            map.removeSource('route');
        }
        
        // Réinitialiser la taille des pins
        if (map.getLayer('unclustered-point')) {
            map.setLayoutProperty('unclustered-point', 'icon-size', 1.0);
        }
    }

    // Initialiser le geocoder pour le mode normal après le chargement de la carte
    function initializeNormalGeocoder() {
        if (!map || normalGeocoder) return;
        
        const geocoderContainer = document.getElementById('normal-geocoder-container');
        if (!geocoderContainer) return;
        
        normalGeocoder = new MapboxGeocoder({
            accessToken: mapboxgl.accessToken,
            mapboxgl: mapboxgl,
            placeholder: 'Rechercher une ville ou UP...',
            countries: 'fr',
            language: 'fr',
            localGeocoder: localUPGeocoder,
            localGeocoderOnly: false,
            limit: 8
        });
        
        // Rendre accessible globalement pour le reset
        window.normalGeocoder = normalGeocoder;
        
        // Ajouter le geocoder avant le bouton de géolocalisation
        const geolocateBtn = document.getElementById('normal-geolocate');
        if (geolocateBtn && geolocateBtn.parentNode) {
            geolocateBtn.parentNode.insertBefore(normalGeocoder.onAdd(map), geolocateBtn);
        } else {
            geocoderContainer.appendChild(normalGeocoder.onAdd(map));
        }
        
        // Gérer les résultats de recherche
        normalGeocoder.on('result', function(e) {
            if (e.result && e.result.geometry) {
                // Définir le centre de recherche
                currentSearchCenter = e.result.geometry.coordinates;
                
                // Stocker la sélection pour persistance entre modes
                currentPointAFeature = e.result;
                isPointAFromUP = !!(e.result.properties && (e.result.properties.UP || e.result.properties['Nom du site']));
                
                // Afficher le contrôle de rayon et définir à 80 km
                showRadiusControl();
                currentSearchRadius = 80;
                const radiusSlider = document.getElementById('radius-slider');
                if (radiusSlider) radiusSlider.value = 80;
                const radiusValue = document.getElementById('radius-value');
                if (radiusValue) radiusValue.textContent = "80 km";
                
                // Dessiner le cercle de 80 km autour du point sélectionné
                drawSearchRadiusCircle(currentSearchCenter, 80);
                
                map.flyTo({
                    center: e.result.geometry.coordinates,
                    zoom: 12,
                    duration: 1500
                });
                
                // Appliquer les filtres avec le rayon de 80 km après le zoom
                setTimeout(() => {
                    applyFilters();
                }, 1600);
            }
        });
    }

    // Attendre que la carte soit initialisée
    const checkMapInterval = setInterval(() => {
        if (window.map) {
            clearInterval(checkMapInterval);
            initializeNormalGeocoder();
        }
    }, 100);

    // Event listeners pour les boutons
    modeNormalBtn.addEventListener('click', window.switchToNormalMode);
    modeRouteBtn.addEventListener('click', window.switchToRouteMode);

    // Géolocalisation pour le mode normal
    const normalGeolocateBtn = document.getElementById('normal-geolocate');
    if (normalGeolocateBtn) {
        normalGeolocateBtn.addEventListener('click', function() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    function(position) {
                        const userLocation = [position.coords.longitude, position.coords.latitude];
                        
                        // Définir le centre de recherche
                        currentSearchCenter = userLocation;
                        
                        // Afficher le contrôle de rayon et définir à 80 km
                        showRadiusControl();
                        currentSearchRadius = 80;
                        const radiusSlider = document.getElementById('radius-slider');
                        if (radiusSlider) radiusSlider.value = 80;
                        const radiusValue = document.getElementById('radius-value');
                        if (radiusValue) radiusValue.textContent = "80 km";
                        
                        // Dessiner le cercle de 80 km
                        drawSearchRadiusCircle(userLocation, 80);
                        
                        // Zoomer pour voir tout le rayon
                        map.flyTo({
                            center: userLocation,
                            zoom: 9.5,
                            duration: 1500
                        });
                        
                        // Supprimer l'ancien marker s'il existe
                        if (userLocationMarker) {
                            userLocationMarker.remove();
                        }
                        
                        // Ajouter un nouveau marker pour la position de l'utilisateur
                        userLocationMarker = new mapboxgl.Marker({ color: '#FF0000' })
                            .setLngLat(userLocation)
                            .addTo(map);
                        
                        // Appliquer les filtres avec le rayon de 80 km
                        applyFilters();
                        
                        // Mettre à jour les établissements visibles
                        setTimeout(() => {
                            updateSidebarBasedOnMapViewport();
                        }, 1600);
                    },
                    function(error) {
                        alert('Impossible de récupérer votre position: ' + error.message);
                    }
                );
            } else {
                alert('La géolocalisation n\'est pas supportée par votre navigateur');
            }
        });
    }

    // Initialiser en mode normal par défaut
    window.switchToNormalMode();
}
