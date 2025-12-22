import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';

// Signal Hub 应用入口，注册 Pinia 以统一管理跨渠道消息。
const app = createApp(App);
app.use(createPinia());
app.mount('#app');
