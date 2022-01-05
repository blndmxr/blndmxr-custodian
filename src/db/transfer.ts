import assert from 'assert';

import pg from 'pg';

import * as hi from 'blindmixer-lib';
import { withTransaction, pool } from './util';
import {custodianInfo, ackSecretKey } from '../custodian-info';

// Returns 'DOUBLE_SPEND' on error. On success returns the claimable and if it's new or not
type InsertRes =
  | [hi.Acknowledged.Claimable, boolean]
  | ('DOUBLE_SPEND' | 'NOT_AUTHORIZED_PROPERLY' | 'CHEATING_ATTEMPT');

export async function insertTransfer(transfer: hi.LightningPayment | hi.Hookout | hi.FeeBump): Promise<InsertRes> {
  const transferHash = transfer.hash();

  // TODO: use hi.Acknowledged.Transfer type

  // check valid auth (again? how many times have we actually already checked this..?): TODO
  const isAuthed = transfer.isAuthorized();
  if (!isAuthed) {
    return 'NOT_AUTHORIZED_PROPERLY';
  }

  // we enforce this client-side so..
  if (transfer.inputs.length > 256) {
    throw 'max of 256 inputs';
  }

  // wrap around transaction so we make sure there are no concurrent requests inserting into transfer_inputs
  // await withTransaction(async (dbClient) => {
  //   for (const coin of transfer.inputs) {
  //     const owner: string = coin.owner.toPOD();
  //     // verify unblinded signature, else return cheat attempt!
  //     const existenceProof: hi.Signature = coin.receipt;
  //     const isValid = existenceProof.verify(coin.owner.buffer, custodianInfo.blindCoinKeys[coin.magnitude.n]);
  //     if (!isValid) {
  //       return 'CHEATING_ATTEMPT'; // actually a cheating attempt!
  //     }
  //     let validity;
  //     try {
  //       validity = await dbClient.query(`SELECT owner from transfer_inputs WHERE owner = $1`, [owner]);
  //       if (validity.rows.length != 0) {
  //         return 'DOUBLE_SPEND'; // Already seen
  //       }
  //     } catch (err) {
  //       throw err;
  //     }
  //   }
  // });

  return withTransaction(async (client) => {
    // I don't see any other solution?
    // await client.query('LOCK TABLE transfer_inputs IN ACCESS EXCLUSIVE MODE');

    let decay = 0;

    for (const coin of transfer.inputs) {
      const owner: string = coin.owner.toPOD();
      // verify unblinded signature, else return cheat attempt!
      const existenceProof: hi.Signature = coin.receipt;

      if (coin.period > custodianInfo.blindCoinKeys.length) {
        return "CHEATING_ATTEMPT";
      }
      
      // we follow the coins period flag, no reason for him to lie else verification will fail
      const isValid = existenceProof.verify(coin.owner.buffer, custodianInfo.blindCoinKeys[custodianInfo.blindCoinKeys.length - coin.period][coin.magnitude.n]);
      
      let multiplier = ((custodianInfo.blindCoinKeys.length - 1 - coin.period) / 100)

      // if mroe than 100 periods have passed since ack, coin is worthless
      if (multiplier > 1) { 
        multiplier = 1;
      }

      // if less than 1 period has passed, coin has negative decay, not possible so decay is 0
      if (multiplier < 0) { 
        multiplier = 0;
      }
      decay += Math.round(((2 ** coin.magnitude.n) * multiplier));    


      if (!isValid) {
        return 'CHEATING_ATTEMPT'; // actually a cheating attempt!
      }
      let validity;
      try {
        validity = await client.query(`SELECT owner from transfer_inputs WHERE owner = $1`, [owner]);
        if (validity.rows.length != 0) {
          return 'DOUBLE_SPEND'; // Already seen
        }
      } catch (err) {
        throw err;
      }
    }

    if (decay != transfer.decay) { 
      return 'CHEATING_ATTEMPT'
    }

    const ackdClaimble: hi.Acknowledged.Claimable = hi.Acknowledged.acknowledge(transfer, ackSecretKey);

    let res = await client.query(`INSERT INTO claimables(claimable) VALUES($1) ON CONFLICT DO NOTHING`, [
      ackdClaimble.toPOD(),
    ]);
    if (res.rowCount === 0) {
      return [ackdClaimble, false];
    }
    assert.strictEqual(res.rowCount, 1);

    // TODO: do this in a single query...
    for (const coin of transfer.inputs) {
      const owner: string = coin.owner.toPOD();
      try {
        res = await client.query(`INSERT INTO transfer_inputs(owner, transfer_hash) VALUES ($1, $2)`, [
          owner,
          transferHash.toPOD(),
        ]);
      } catch (err) {
        // this should never be used.
        // if (err.code === '23505' && err.constraint === 'transfer_inputs_pkey') {
        //   return 'DOUBLE_SPEND';
        // }
        console.log(
          `[transfer issue]: ${err} when inserting input ${owner} and claimable ${ackdClaimble.toPOD().hash}`
        );
        throw err;
      }
    }

    return [ackdClaimble, true];
  });
}

// type TxInfo = { txid: string; hex: string; fee: number };
// export async function insertBitcoinTransaction(client: pg.PoolClient, tx: TxInfo) {
//   await client.query(
//     `INSERT INTO bitcoin_transactions(txid, hex, fee, status)
//         VALUES($1, $2, $3, $4)`,
//     [tx.txid, tx.hex, tx.fee, 'SENDING']
//   );
// }
