import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { McpClientProvider } from './mcp/context.js';
import './theme/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <McpClientProvider>
      <App />
    </McpClientProvider>
  </React.StrictMode>,
);
