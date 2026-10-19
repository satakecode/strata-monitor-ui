# Strata Request Monitor UI

A standalone Node.js dashboard for Strata's request monitor endpoints:

- `GET /api/requests`
- `GET /api/requests?id=<request-id>`

## Attribution and license

The dashboard UI was copied and adapted from Strata's API Monitor in [`apps/host`](https://github.com/Niko1221/Strata/tree/main/apps/host). Strata is Copyright © 2026 Niko1221 and the Strata contributors. This project uses the same MIT License; see [LICENSE](LICENSE).

## Run

Requires Node.js 18 or newer. No packages need to be installed.

```sh
npm start
```

Open <http://127.0.0.1:3333>. The dashboard defaults to the Strata API at
`http://127.0.0.1:8080`. Set another address or optional API key in **Settings**.
The key can be sent as `X-API-Key` or `Authorization: Bearer`.

Enable the request monitor in Strata's configuration:

```json
{ "api_monitor": true }
```

Set `PORT` to change the UI port, for example:

```sh
PORT=3334 npm start
```

The Node server binds to `127.0.0.1` and proxies live API requests so the
dashboard does not depend on browser CORS configuration. The base URL and API
key are only used for the requests you make from this local UI.
