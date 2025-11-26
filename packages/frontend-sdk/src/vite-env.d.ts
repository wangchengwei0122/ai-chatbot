/// <reference types="vite/client" />

declare module '*.css?inline' {
  const content: string;
  export default content;
}

import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type QccAiChatbotAttributes = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  'proxy-url'?: string;
  mcp?: string;
  provider?: string;
  model?: string;
  title?: string;
  'theme-color'?: string;
  debug?: string;
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'qcc-ai-chatbot': QccAiChatbotAttributes;
    }
  }
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      'qcc-ai-chatbot': QccAiChatbotAttributes;
    }
  }
}
