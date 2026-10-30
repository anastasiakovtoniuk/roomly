import { createApp } from './app';
import { serverPort } from './config/env';

createApp().listen(serverPort, () => {
  console.log(`Roomly API: http://localhost:${serverPort}/api/health`);
});
