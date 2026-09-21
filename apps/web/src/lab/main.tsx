import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LabPage } from './LabPage';
import { LAB_ENTRIES } from './registry';
import '../styles.css';
import './lab.css';

/**
 * The lab's own entry. It imports the game's stylesheet for the colour names
 * and the base rules, and nothing else of the game: not `App`, not the store,
 * not the feed, not `boot`. Loading this page therefore opens no socket and
 * starts no game.
 */

const rootElement = document.getElementById('lab-root');
if (rootElement === null) {
  throw new Error('Lab root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <LabPage entries={LAB_ENTRIES} />
  </StrictMode>,
);
