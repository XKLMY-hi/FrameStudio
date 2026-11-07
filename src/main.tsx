import React from 'react';import {createRoot} from 'react-dom/client';import TheaterApp from './theater/TheaterApp';import './theater/theater.css';
import './theater/tonal-stage.css';
createRoot(document.getElementById('root')!).render(<TheaterApp/>);
