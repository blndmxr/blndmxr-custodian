// import * as hi from 'blindmixer-lib';

// import { pool } from '../db/util';

// export default async function lightningReceiveds(url: string) {
//   const invoiceHashStr = url.substring('/lightning-receiveds/'.length);

//   const paymentHash = hi.Hash.fromPOD(invoiceHashStr);
//   if (paymentHash instanceof Error) {
//     throw 'invalid payment hash';
//   }

//   const { rows } = await pool.query(`SELECT * FROM lightning_invoices WHERE hash = $1 AND settle_amount IS NOT NULL`, [
//     invoiceHashStr,
//   ]);

//   if (rows.length === 0) {
//     return null;
//   }
//   const row = rows[0];

//   return {
//     amount: row.settle_amount as number,
//     rPreimage: row.r_preimage as string,
//   };
// }
