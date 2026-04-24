# CCBill — Error Codes Reference

> Load this file when debugging transaction failures, decline
> codes, or API errors.

## RESTful API Error Codes

### HTTP 400 — Bad Request (Validation)

| Code   | Message                          | Category    | Action                    |
| ------ | -------------------------------- | ----------- | ------------------------- |
| 100100 | Invalid client account           | Validation  | Verify account credentials|
| 100102 | Expired payment token            | Soft decline| Request new token         |
| 100105 | Invalid payout type              | Validation  | Confirm payout config     |
| 100106 | Invalid privacy type             | Validation  | Review privacy settings   |
| 100107 | Invalid program category         | Validation  | Verify program category   |
| 100108 | Invalid payment type             | Validation  | Confirm payment method    |
| 100109 | Invalid program participation    | Validation  | Check participation       |
| 200000 | Multiple (attribute/card/email)  | Validation  | Review request params     |

### HTTP 401 — Unauthorized

| Code | Message         | Category       | Action                        |
| ---- | --------------- | -------------- | ----------------------------- |
| N/A  | `invalid_token` | Authentication | Obtain new OAuth2 token       |

### HTTP 403 — Forbidden

| Code   | Message   | Category      | Action                     |
| ------ | --------- | ------------- | -------------------------- |
| 100020 | Forbidden | Authorization | Verify account permissions |

### HTTP 404 — Not Found

| Code   | Message                    | Category   | Action                 |
| ------ | -------------------------- | ---------- | ---------------------- |
| 100101 | Invalid payment token      | Validation | Confirm token exists   |
| 100104 | Lookup Object Not Found    | Validation | Verify object ID       |

### HTTP 500 — Server Error

| Code   | Message                              | Category     | Action             |
| ------ | ------------------------------------ | ------------ | ------------------- |
| 100103 | Transaction error                    | Processing   | Retry              |
| 100110 | Throttled, transaction limit reached | Rate limit   | Wait + retry       |
| 100111 | Throttled, amount limit reached      | Rate limit   | Reduce amount/wait |
| 100112 | Unable to determine if 3DS required  | 3DS          | Contact support    |
| 100113 | Unable to retrieve authorized amount | Processing   | Verify auth        |

### 3DS Authentication Errors

| Code   | HTTP | Category   | Action                       |
| ------ | ---- | ---------- | ---------------------------- |
| 200001 | 500  | 3DS        | Retry with updated 3DS data  |
| 200400 | 500  | 3DS        | Validate 3DS parameters      |
| 200500 | 500  | Auth       | Check transaction details    |
| 200502 | 400  | Validation | Confirm token validity       |
| 200603 | 400  | Validation | Verify UUID format           |
| 200604 | 400  | Validation | Verify timestamp format      |
| 200605 | 400  | Validation | Verify UUID/timestamp        |

## Soft vs Hard Declines

**Soft declines** (retriable):
- 100102 (expired token) — request new token
- 100103 (transaction error) — retry with backoff
- 100110, 100111 (throttling) — wait and retry

**Hard declines** (non-retriable):
- 100100, 100106-100109 (validation) — fix request
- 200603-200605 (format) — fix data format

## Driver Error Handling

The `CCBillDriver` should:
1. Parse the JSON error response
2. Extract `errorCode` and `message`
3. Map soft declines to retriable errors
4. Map hard declines to permanent failures
5. Log all errors with the error code for debugging
6. Never expose raw CCBill error messages to users

## Relevant URLs

- Error Codes: https://ccbill.com/doc/error-codes
- Soft vs Hard Decline: https://ccbill.com/kb/soft-decline-vs-hard-decline
