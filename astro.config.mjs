// @ts-check
import dotenv from 'dotenv';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import nodeWebSocket from "astro-node-websocket"

const base = '/' // make this the directory where all the pages go
//server is base but switch client with server
//const server = base.replace('client', 'server');

// https://astro.build/config
export default defineConfig({
  output: 'server',
  base: base, //where the project is deployed
  vite: {
    css: {
      postcss: './postcss.config.js',
    },
  },
  adapter: nodeWebSocket({ mode: "standalone" }), 

  integrations: [react()],
});
