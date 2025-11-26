import './styles/chatbot.css';
import { QccAiChatbot } from './components/chat-widget';

export { QccAiChatbot };

if (!customElements.get('qcc-ai-chatbot')) {
  customElements.define('qcc-ai-chatbot', QccAiChatbot);
}


