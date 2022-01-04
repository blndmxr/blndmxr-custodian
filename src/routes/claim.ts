import * as hi from 'blindmixer-lib';
import StatusClaimed from 'blindmixer-lib/dist/status/claimed';

import * as nonceLookup from '../util/nonces';
import { blindingSecretKeys } from '../custodian-info';

import { pool, withTransaction } from '../db/util';

import * as assert from 'assert';
import { insertStatus } from '../db/status';

export default async function claim(body: any) {
  const claimRequest = hi.ClaimRequest.fromPOD(body);
  if (claimRequest instanceof Error) {
    throw claimRequest;
  }

  if (claimRequest.coinPeriod != blindingSecretKeys.length) { 
    throw "WRONG_KEYS"
  }
  
  // we should calculate if the user abides by his wallet to create 
  // the most efficient coin-request and not spam the custodian with 1000s of coinrequests of 0 magnitude.
  if (claimRequest.coinRequests.length > 256)  { // this seems like a *very* fair assumption
    throw 'INEFFICIENT_CLAIM_REQUEST' 
  }

  const claimHash = claimRequest.claimableHash.toPOD();

  return withTransaction(async (client) => {
    let claimable;

    {
      // First we need to know what's being claimed (so we can get the claimant)
      const { rows } = await client.query(`SELECT claimable FROM claimables WHERE claimable->>'hash' = $1 FOR UPDATE`, [
        claimHash,
      ]);

      if (rows.length !== 1) {
        throw 'claimable hash not found';
      }

      claimable = hi.claimableFromPOD(rows[0]['claimable']);
      if (claimable instanceof Error) {
        throw claimable;
      }
    }

    const { rows } = await client.query(`SELECT status FROM statuses WHERE status->>'claimableHash' = $1`, [claimHash]);

    const statuses = rows.map((row: any) => {
      const s = hi.statusFromPOD(row['status']);
      if (s instanceof Error) {
        throw s;
      }
      return s;
    });

    let toClaim = hi.computeClaimableRemaining(claimable, statuses);
    if (toClaim === 0 || toClaim !== claimRequest.amount()) {
      console.log('Trying to claim: ', claimRequest.amount(), ' but should be claiming: ', toClaim);
      throw 'WRONG_CLAIM_AMOUNT';
    }

    if (!claimRequest.authorization.verify(claimRequest.hash().buffer, claimable.claimant)) {
      throw 'AUTHORIZATION_FAIL';
    }

    const { coinRequests } = claimRequest;

    const blindingNonces = coinRequests.map((coin) => coin.blindingNonce.toPOD());

    const secretNonces = nonceLookup.pull(blindingNonces);

    assert.strictEqual(coinRequests.length, secretNonces.length);

    const blindedExistenceProofs = [];

    for (let i = 0; i < secretNonces.length; i++) {
      const secretNonce = secretNonces[i];
      const coinReq = coinRequests[i];

      const blindedExistenceProof = hi.blindSign(
        blindingSecretKeys[blindingSecretKeys.length - claimRequest.coinPeriod][coinReq.magnitude.n], // 0  = newest     // if we change keys mid-signing, still use the old keys (very unlikely);
        secretNonce,
        coinReq.blindedOwner
      );
      blindedExistenceProofs.push(blindedExistenceProof);
    }

    const claimedStatus = new StatusClaimed(claimRequest, blindedExistenceProofs);

    return insertStatus(claimedStatus, client);
  });
}
