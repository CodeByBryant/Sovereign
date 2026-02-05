import './styles/main.scss';
import { Simulation } from './core/Simulation';

// Initialize the application
window.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  
  if (!canvas) {
    console.error('Canvas element not found');
    return;
  }

  // Create and initialize simulation
  const simulation = new Simulation(canvas);
  await simulation.init();
  simulation.start();

  console.log('Sovereign initialized successfully!');
});
