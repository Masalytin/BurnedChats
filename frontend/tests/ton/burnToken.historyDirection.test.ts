import { describe, expect, it } from 'vitest';
import { mapCenterTxToBurnRow } from '@/ton/burnToken';

/**
 * Fixtures from testnet tx 0ddeecdde65cb2b694643868631ebecbb9e030ccc12bfd136be9d0b6b3343f44
 * (Ton Center getTransactions on sender/recipient jetton wallets, 2026-06-28).
 */
const SENDER_JW_SEND_BODY_IN =
  'te6cckEBAQEAWgAAsA+KfqUAAAAAAAAAAFAo+mrgCAB0snB1hTELiiQXZmTTG9kO4N8OELbGfRBxbdqUZTufwwAOlk4OsKYhcUSC7MyaY3sh3BvhwhbYz6IOLbtSjKdz+EcxLQDp+g9I';
const SENDER_JW_SEND_BODY_OUT =
  'te6cckEBAQEAWgAArxeNRRkAAAAAAAAAAFAokYNoCAD4tnUpNUTTeqq7dt19gUYacXgqjuyfy+W+CZQex1HQHQAOlk4OsKYhcUSC7MyaY3sh3BvhwhbYz6IOLbtSjKdz+E5iWgHL16Bl';
const RECIPIENT_JW_RECEIVE_BODY_IN = SENDER_JW_SEND_BODY_OUT;

describe('mapCenterTxToBurnRow — send/receive direction', () => {
  it('classifies sender jetton-wallet tx as send when in JettonTransfer + out JettonInternalTransfer', () => {
    const row = mapCenterTxToBurnRow({
      utime: 1782637250,
      transaction_id: { lt: '79587660000003', hash: 'bRe6FdOL8hqY/0hNFd3vypS2qm3eaMUsh60ZJu5TAEU=' },
      in_msg: {
        source: 'EQB8WzqUmqJpvVVdu26-wKMNOLwVR3ZP5fLfBMoPY6joDm07',
        destination: 'EQCQd4JvaQnjCNolRItEcNp1U0jEZIH4c0p532MKaL3xKt8U',
        msg_data: { body: SENDER_JW_SEND_BODY_IN },
      },
      out_msgs: [
        {
          source: 'EQCQd4JvaQnjCNolRItEcNp1U0jEZIH4c0p532MKaL3xKt8U',
          destination: 'EQBEe8Dha8eAOJnufATD5YHLgJSrpNdAXBU-QxGts8hjuRXN',
          msg_data: { body: SENDER_JW_SEND_BODY_OUT },
        },
      ],
    });

    expect(row.type).toBe('send');
    expect(row.amount).toBe(11_000_000_000n);
    expect(row.counterparty).toBe('EQBEe8Dha8eAOJnufATD5YHLgJSrpNdAXBU-QxGts8hjuRXN');
  });

  it('classifies recipient jetton-wallet tx as receive on JettonInternalTransfer in_msg', () => {
    const row = mapCenterTxToBurnRow({
      utime: 1782637250,
      transaction_id: { lt: '79587660000005', hash: 'iQYZvH4oLyOWvo5aPIMVff+kj+O+9MyemEda4sBQeR4=' },
      in_msg: {
        source: 'EQCQd4JvaQnjCNolRItEcNp1U0jEZIH4c0p532MKaL3xKt8U',
        destination: 'EQBEe8Dha8eAOJnufATD5YHLgJSrpNdAXBU-QxGts8hjuRXN',
        msg_data: { body: RECIPIENT_JW_RECEIVE_BODY_IN },
      },
      out_msgs: [
        {
          source: 'EQBEe8Dha8eAOJnufATD5YHLgJSrpNdAXBU-QxGts8hjuRXN',
          destination: 'EQA6WTg6wpiFxRILszJpjeyHcG-HCFtjPog4tu1KMp3P4Wiv',
          msg_data: {
            body: 'te6cckEBAQEANQAAZnNi0JwAAAAAAAAAAFAokYNoCAD4tnUpNUTTeqq7dt19gUYacXgqjuyfy+W+CZQex1HQHBxtxBE=',
          },
        },
      ],
    });

    expect(row.type).toBe('receive');
    expect(row.amount).toBe(10_890_000_000n);
    expect(row.counterparty).toBe('EQCQd4JvaQnjCNolRItEcNp1U0jEZIH4c0p532MKaL3xKt8U');
  });

  it('regression: JettonTransfer in_msg alone (no internal out) stays send', () => {
    const row = mapCenterTxToBurnRow({
      utime: 1782637250,
      transaction_id: { hash: 'failed-send-hash' },
      in_msg: {
        source: 'EQB8WzqUmqJpvVVdu26-wKMNOLwVR3ZP5fLfBMoPY6joDm07',
        destination: 'EQCQd4JvaQnjCNolRItEcNp1U0jEZIH4c0p532MKaL3xKt8U',
        msg_data: { body: SENDER_JW_SEND_BODY_IN },
      },
      out_msgs: [],
    });

    expect(row.type).toBe('send');
    expect(row.amount).toBe(11_000_000_000n);
  });
});
