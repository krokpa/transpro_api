# TransPro — API Partenaires (publique)

API REST pour les applications tierces : recherche de voyages, gares, itinéraires,
réservations et suivi de colis.

- **Base URL** : `https://<votre-domaine>/api/v1`
- **Documentation interactive (Swagger)** : `/developers`
- **Préfixe des endpoints publics** : `/ext`

---

## 1. Authentification

Toutes les requêtes nécessitent votre clé API dans le header **`X-API-Key`** :

```bash
curl https://api.transpro.ci/api/v1/ext/trips?origin=Abidjan&destination=Bouake&date=2026-07-01 \
  -H "X-API-Key: tpk_live_xxxxxxxxxxxxxxxxxxxxxxxx"
```

- Les clés de **production** commencent par `tpk_live_`.
- Les clés de **test (sandbox)** commenceront par `tpk_test_` *(à venir — Phase 3)*.
- Gardez votre clé secrète. En cas de fuite, révoquez-la et créez-en une nouvelle.

---

## 2. Plans, scopes & quotas

Chaque endpoint exige un **scope**, accordé selon votre **plan**.

| Plan | Quota mensuel | Scopes |
|------|---------------|--------|
| `STARTER` | 5 000 req | `trips:read`, `stations:read`, `routes:read`, `parcels:read` |
| `BUSINESS` | 50 000 req | + `bookings:read`, `bookings:write`, `parcels:write` |
| `ENTERPRISE` | illimité | tous |

### Headers de quota (présents sur chaque réponse)

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Quota mensuel de votre plan (`unlimited` pour Enterprise) |
| `X-RateLimit-Remaining` | Requêtes restantes ce mois-ci |
| `X-RateLimit-Reset` | Timestamp Unix (s) de réinitialisation du quota |

En cas de dépassement : **HTTP 429** + header `Retry-After` (secondes).

---

## 3. Format des réponses

Toutes les réponses suivent une enveloppe standard :

```json
{ "success": true, "data": <résultat>, "timestamp": "2026-06-23T14:00:00.000Z" }
```

En cas d'erreur :

```json
{ "success": false, "statusCode": 404, "message": "Voyage introuvable", "timestamp": "..." }
```

| Code | Signification |
|------|---------------|
| `401` | Clé API manquante, invalide, révoquée ou expirée |
| `403` | IP non autorisée ou scope insuffisant |
| `404` | Ressource introuvable |
| `422` | Paramètres invalides |
| `429` | Quota mensuel dépassé (voir `Retry-After`) |

---

## 4. Périmètre des données (opt-in)

Les consumers **cross-compagnie** ne voient que les compagnies ayant **activé l'API
publique**. Un consumer rattaché à une compagnie spécifique ne voit que ses propres
données.

---

## 5. Endpoints

### Voyages
- `GET /ext/trips` — Rechercher des voyages
  - Query : `origin`, `destination`, `date` (YYYY-MM-DD), `passengers`, `limit` (≤100), `offset`
  - Scope : `trips:read`
- `GET /ext/trips/:id` — Détails d'un voyage — Scope : `trips:read`

### Gares & itinéraires
- `GET /ext/stations` — Gares actives (`limit`, `offset`) — Scope : `stations:read`
- `GET /ext/routes` — Itinéraires actifs (`limit`, `offset`) — Scope : `routes:read`

### Réservations
- `POST /ext/bookings` — Créer une réservation — Scope : `bookings:write`
  - Envoyez un header **`Idempotency-Key`** (UUID) pour pouvoir rejouer la
    requête sans créer de doublon : un rejeu renvoie la réponse d'origine.
  ```json
  {
    "tripId": "…",
    "passengerName": "Awa Koné",
    "passengerPhone": "+2250700000000",
    "passengerEmail": "awa@example.com",
    "seatNumbers": ["A1", "A2"]
  }
  ```
  > La réservation est créée au statut `PENDING` (expire après 15 min).
  > Le déclenchement du paiement via API est prévu en **Phase 2**.
- `GET /ext/bookings/:reference` — Récupérer une réservation — Scope : `bookings:read`

### Colis
- `GET /ext/parcels/:code` — Suivre un colis par code de tracking — Scope : `parcels:read`

### Méta
- `GET /ext/me` — Infos sur le consumer et la clé courante

---

## 6. Webhooks

Configurez une `webhookUrl` sur votre compte (via l'équipe TransPro). Un secret
de signature `whsec_…` est généré ; il sert à vérifier l'authenticité des appels.

### Événements
| Événement | Déclencheur |
|-----------|-------------|
| `BOOKING_CONFIRMED` | Paiement d'une réservation confirmé |
| `BOOKING_CANCELLED` | Réservation annulée (expiration de paiement ou voyage annulé) |
| `TRIP_DELAYED` | Voyage retardé |
| `TRIP_CANCELLED` | Voyage annulé par la compagnie |
| `PARCEL_STATUS_CHANGED` | Statut d'un colis modifié (diffusé aux intégrations de la compagnie) |

### Format de l'appel (POST vers votre URL)
Headers :
- `X-TransPro-Event` — type d'événement
- `X-TransPro-Delivery` — id unique de livraison
- `X-TransPro-Timestamp` — horodatage (ms)
- `X-TransPro-Signature` — `sha256=<hmac>`

Corps :
```json
{ "id": "<delivery>", "event": "BOOKING_CONFIRMED", "createdAt": "…", "data": { … } }
```

### Vérifier la signature
HMAC-SHA256 de `"{timestamp}.{corps brut}"` avec votre `webhookSecret` :
```js
const expected = crypto.createHmac('sha256', secret)
  .update(`${timestamp}.${rawBody}`).digest('hex');
// comparer `sha256=${expected}` au header X-TransPro-Signature
```

### Fiabilité
Répondez `2xx` rapidement. En cas d'échec, TransPro réessaie jusqu'à **6 fois**
avec backoff (1 min → 24 h). Soyez **idempotent** (utilisez `X-TransPro-Delivery`).

---

## 7. Sandbox (mode test)

Générez une **clé de test** (`tpk_test_…`) depuis le portail développeur pour
intégrer sans risque :
- Les endpoints de **lecture** fonctionnent sur les données réelles.
- Les clés de test **ne décomptent pas** votre quota (header `X-RateLimit-Limit: unlimited`).
- Chaque réponse porte le header `X-TransPro-Environment: test`.
- `POST /ext/bookings` renvoie une **réservation simulée** (`"test": true`) :
  les entrées sont validées mais **aucune réservation réelle** n'est créée et
  les places ne sont pas impactées.

### Tester vos webhooks
```
POST /ext/test/trigger-webhook
Body (optionnel): { "event": "BOOKING_CONFIRMED" }
```
Envoie un événement d'exemple signé vers votre `webhookUrl`. Réservé aux clés de test.

---

## 8. Bonnes pratiques

- **Mettez en cache** les listes peu changeantes (`/stations`, `/routes`).
- **Paginez** avec `limit`/`offset` plutôt que de tout charger.
- **Surveillez** `X-RateLimit-Remaining` pour anticiper les `429`.
- **Ne stockez jamais** la clé API côté client (navigateur/mobile) : appelez l'API
  depuis votre backend.

---

## 9. SDK & génération de clients

- **SDK TypeScript officiel** (sans dépendance) : `docs/sdk/transpro.ts` — client typé
  pour tous les endpoints `/ext` + `verifyWebhookSignature`. Voir `docs/sdk/README.md`.
- **OpenAPI 3.0** servie publiquement à **`/developers-json`** — générez un client dans
  n'importe quel langage avec [openapi-generator](https://openapi-generator.tech/) :
  ```bash
  openapi-generator-cli generate -i https://api.transpro.ci/developers-json -g python -o ./sdk-py
  ```

## 10. Versioning

L'API est versionnée par URL (`/api/v1`). Les changements incompatibles
introduiront `/api/v2` avec une période de dépréciation annoncée.

---

*Besoin d'un accès ? Contactez l'équipe TransPro pour obtenir un compte développeur
et vos clés API.*
