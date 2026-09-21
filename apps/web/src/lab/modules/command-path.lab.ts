import type { LabEntry } from '../types';

const entry: LabEntry = {
  id: 'command-path',
  order: 4,
  title: 'Server command path',
  summary:
    "One pure function from the game's state and a command to the next state and a reply: safe retries by command id, explicit outcomes, every input logged.",
  builtAgainst: 'the game state in shared code, no sockets',
};

export default entry;
