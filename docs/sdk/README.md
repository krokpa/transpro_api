# SDK TransPro — API Partenaires

Client TypeScript/JavaScript **officiel** et **sans dépendance** pour l'API publique TransPro.

## Installation

Copiez `transpro.ts` dans votre projet (ou publiez-le comme package interne). Requiert
Node 18+ (ou un environnement avec `fetch` et WebCrypto).

## Démarrage

```ts
import { TransProClient, verifyWebhookSignature } from './transpro';

const client = new TransProClient({
  apiKey: process.env.TRANSPRO_API_KEY!,        // tpk_live_… ou tpk_test_…
  baseUrl: 'https://api.transpro.ci/api/v1',     // optionnel
});

// Rechercher des voyages
const trips = await client.searchTrips({
  origin: 'Abidjan', destination: 'Bouaké', date: '2026-07-01', passengers: 2,
});

// Créer une réservation (idempotent)
const booking = await client.createBooking(
  { tripId: trips[0].id, passengerName: 'Awa Koné', passengerPhone: '+2250700000000', seatNumbers: ['A1', 'A2'] },
  { idempotencyKey: crypto.randomUUID() },
);

// Suivre un colis
const parcel = await client.trackParcel('TPX123');

// Quota de la dernière réponse
console.log(client.lastRateLimit); // { limit, remaining, reset, environment }
```

## Vérifier un webhook

```ts
// Express : app.post('/webhooks', express.raw({ type: 'application/json' }), ...)
const ok = await verifyWebhookSignature(
  process.env.WEBHOOK_SECRET!, // whsec_…
  {
    timestamp: req.header('X-TransPro-Timestamp')!,
    signature: req.header('X-TransPro-Signature')!,
  },
  req.body.toString('utf8'), // corps BRUT
);
if (!ok) return res.status(401).end();
```

## Générer un SDK dans un autre langage

La spécification **OpenAPI 3.0** est servie publiquement :

```
GET https://<votre-domaine>/developers-json
```

Utilisez-la avec [openapi-generator](https://openapi-generator.tech/) pour produire
un client Python, PHP, Go, etc. :

```bash
openapi-generator-cli generate -i https://api.transpro.ci/developers-json -g python -o ./transpro-python
```
