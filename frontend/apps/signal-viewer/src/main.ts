import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';

// Viewer 也复用 Pinia，方便共享 BroadcastChannel 收到的状态。
const app = createApp(App);
app.use(createPinia());
app.mount('#app');
