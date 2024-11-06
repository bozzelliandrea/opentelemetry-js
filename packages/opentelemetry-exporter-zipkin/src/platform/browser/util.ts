/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { diag } from '@opentelemetry/api';
import {
  ExportResult,
  ExportResultCode,
  globalErrorHandler,
} from '@opentelemetry/core';
import * as zipkinTypes from '../../types';

/**
 * Prepares send function that will send spans to the remote Zipkin service.
 * @param urlStr - url to send spans
 * @param headers - headers
 * send
 */
export async function prepareSend(
  urlStr: string,
  headers?: Record<string, string>
): Promise<zipkinTypes.SendFn> {
  let xhrHeaders: Record<string, string | Function>;
  const useBeacon = typeof navigator.sendBeacon === 'function' && !headers;
  if (headers) {
    xhrHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    };
  }

  /**
   * Send spans to the remote Zipkin service.
   */
  return async function send(
    zipkinSpans: zipkinTypes.Span[],
    done: (result: ExportResult) => void
  ) {
    if (zipkinSpans.length === 0) {
      diag.debug('Zipkin send with empty spans');
      return done({ code: ExportResultCode.SUCCESS });
    }
    const payload = JSON.stringify(zipkinSpans);
    if (useBeacon) {
      sendWithBeacon(payload, done, urlStr);
    } else {
      await sendWithXhr(payload, done, urlStr, xhrHeaders);
    }
  };
}

/**
 * Sends data using beacon
 * @param data
 * @param done
 * @param urlStr
 */
function sendWithBeacon(
  data: string,
  done: (result: ExportResult) => void,
  urlStr: string
) {
  if (navigator.sendBeacon(urlStr, data)) {
    diag.debug('sendBeacon - can send', data);
    done({ code: ExportResultCode.SUCCESS });
  } else {
    done({
      code: ExportResultCode.FAILED,
      error: new Error(`sendBeacon - cannot send ${data}`),
    });
  }
}

/**
 * Sends data using XMLHttpRequest
 * @param data
 * @param done
 * @param urlStr
 * @param xhrHeaders
 */
async function sendWithXhr(
  data: string,
  done: (result: ExportResult) => void,
  urlStr: string,
  xhrHeaders: Record<string, string | Function> = {}
) {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', urlStr);

  await Promise.all(
    Object.entries(xhrHeaders).map(async ([k, v]) => {
      if (!v) {
        xhr.setRequestHeader(k, '');
        return;
      }

      if (typeof v === 'string' || v instanceof String) {
        xhr.setRequestHeader(k, v as string);
        return;
      }

      try {
        const result = v();
        if (result instanceof Promise) {
          xhr.setRequestHeader(k, String(await result));
        } else {
          xhr.setRequestHeader(k, String(result));
        }
      } catch (err) {
        diag.error(`Failed Header [${k}] evaluation caused by: ${err}`);
      }
    })
  );

  xhr.onreadystatechange = () => {
    if (xhr.readyState === XMLHttpRequest.DONE) {
      const statusCode = xhr.status || 0;
      diag.debug(`Zipkin response status code: ${statusCode}, body: ${data}`);

      if (xhr.status >= 200 && xhr.status < 400) {
        return done({ code: ExportResultCode.SUCCESS });
      } else {
        return done({
          code: ExportResultCode.FAILED,
          error: new Error(
            `Got unexpected status code from zipkin: ${xhr.status}`
          ),
        });
      }
    }
  };

  xhr.onerror = msg => {
    globalErrorHandler(new Error(`Zipkin request error: ${msg}`));
    return done({ code: ExportResultCode.FAILED });
  };

  // Issue request to remote service
  diag.debug(`Zipkin request payload: ${data}`);
  xhr.send(data);
}
