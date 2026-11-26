import { createApp } from './app';
import { serverPort } from './config/env';
import { startAutoCancelScheduler } from './modules/bookings/autoCancelScheduler';

createApp().listen(serverPort, () => {
  console.log(`Roomly API: http://localhost:${serverPort}/api/health`);
});

// Фонове автоскасування (ADR-0006) лише в процесі сервера: у тестах createApp() таймерів не створює.
startAutoCancelScheduler();
