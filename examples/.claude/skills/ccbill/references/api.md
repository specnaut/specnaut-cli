# CCBill — RESTful Transaction API Reference

> Load this file when implementing subscription management (cancel, refund,
> lookup) or working with payment tokens.

## Base URL

```
Production: https://api.ccbill.com
```

## Authentication — OAuth2

CCBill's RESTful API uses **OAuth2 Bearer tokens**.

### Token Request

```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id={CCBILL_API_CLIENT_ID}
&client_secret={CCBILL_API_CLIENT_SECRET}
```

Response:

```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### Using the Token

```
Authorization: Bearer {access_token}
Accept: application/vnd.mcn.transaction-service.api.v.2+json
```

The `Accept` header specifies the API version. Always use v2+.

## Key Endpoints

### Payment Tokens

| Method | Endpoint                           | Description                 |
| ------ | ---------------------------------- | --------------------------- |
| POST   | `/payment-tokens/merchant-only`    | Create token (non-3DS)      |
| POST   | `/payment-tokens/threeds-required` | Create token (3DS required) |

### Transactions

| Method | Endpoint                               | Description            |
| ------ | -------------------------------------- | ---------------------- |
| POST   | `/transactions/payment-tokens/{token}` | Charge a payment token |
| GET    | `/transactions/{transactionId}`        | Look up a transaction  |

### Subscription Management

For cancellations and lookups, CCBill provides both the RESTful API and the
legacy **DataLink** system. The driver should prefer the RESTful API when
available.

## Payment Token Flow (if needed)

Miximodel uses **FlexForms** (hosted checkout) as the primary flow, so payment
tokens are NOT required for initial checkout. Tokens become relevant for:

- One-click rebilling
- Card-on-file scenarios
- API-initiated charges

For the initial implementation, FlexForms handles everything. Token-based
charging can be added in a future phase.

## DataLink (Legacy Admin API)

DataLink is CCBill's legacy API for administrative operations:

- Cancel subscription
- Look up subscription status
- Retrieve transaction details
- Run reports

DataLink uses a different authentication mechanism (username/password or API key
in query params). It's being gradually replaced by the RESTful API but remains
available.

## Rate Limits

CCBill enforces rate limits on API calls:

| Error Code | Meaning                       | Action             |
| ---------- | ----------------------------- | ------------------ |
| 100110     | Throttled — transaction limit | Wait and retry     |
| 100111     | Throttled — amount limit      | Reduce amount/wait |

Implement exponential backoff for 429/5xx responses.

## Relevant URLs

- RESTful Transaction API: https://ccbill.com/doc/ccbill-restful-transaction-api
- API Resources: https://ccbill.com/doc/ccbill-restful-api-resources
- API Guide: https://ccbill.com/doc/ccbill-api-guide
- Payment Token (non-3DS): https://ccbill.com/doc/create-payment-token-non-3ds
- OAuth: https://ccbill.com/kb/what-is-oauth
- Bearer Auth: https://ccbill.com/kb/authorization-bearer
