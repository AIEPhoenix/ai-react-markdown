/* global setTimeout, clearTimeout */
import { get } from 'node:http';

/** Bound the entire response, including a server that sends headers but stalls its body. */
export function readCatalogResource(url, { json = false, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`${url}: HTTP ${response.statusCode}`));
        response.destroy();
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (json) body += chunk;
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          resolve(json ? JSON.parse(body) : true);
        } catch (error) {
          reject(new Error(`${url}: ${error.message}`));
        }
      });
    });
    const timer = setTimeout(() => {
      reject(new Error(`${url}: response timed out after ${timeoutMs}ms`));
      request.destroy();
    }, timeoutMs);
    request.on('error', reject);
    request.on('close', () => clearTimeout(timer));
  });
}
