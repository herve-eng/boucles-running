import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configureNet } from './engine/net.js';
import { netCache, purgeOldEntries } from './app/lib/cache';
import App from './app/App';
import './app/styles.css';

// Le moteur garde les réponses (tuiles, itinéraires, adresses) dans le navigateur.
// Pas d'en-tête global : un en-tête personnalisé déclencherait une vérification
// CORS supplémentaire que tous les services n'acceptent pas (Valhalla ajoute le sien).
configureNet({ cache: netCache });
purgeOldEntries();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
