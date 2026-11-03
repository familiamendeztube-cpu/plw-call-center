import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('worker', Path(__file__).with_name('worker.py'))
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


class BridgeTests(unittest.TestCase):
    def row(self, direction='inbound', disposition='ANSWERED'):
        return ['100.1','100.1','PJSIP/vocex-000001' if direction == 'inbound' else 'PJSIP/agent-2-000001',
                'PJSIP/agent-3-000002' if direction == 'inbound' else 'PJSIP/vocex-000002',
                '+50688888888','88888888','from-vocex' if direction == 'inbound' else 'from-agents',
                disposition,'25','1700000000','1700000030','2']

    def test_inbound_answer_attributed_to_answering_endpoint(self):
        c = w.parse_cdr(self.row())
        self.assertEqual(c['sip_username'], 'agent-3')
        self.assertEqual(c['talk_seconds'],25)
        self.assertEqual(c['unique_id'], '100.1.2')

    def test_outbound_uses_originating_agent(self):
        self.assertEqual(w.parse_cdr(self.row('outbound'))['sip_username'], 'agent-2')

    def test_unanswered_inbound_never_blames_last_agent(self):
        self.assertIsNone(w.parse_cdr(self.row(disposition='NO ANSWER'))['sip_username'])

    def test_non_originating_legs_ignored(self):
        row = self.row(); row[2] = 'PJSIP/agent-3-000002'
        self.assertIsNone(w.parse_cdr(row))

    def test_snapshot_rejects_duplicate_agents_and_non_booleans(self):
        for rows in [[{'username':'agent-1','available':'true'}],
                     [{'username':'agent-1','available':True}]*2,
                     [{'username':'agent-1;bad','available':True}]]:
            with self.assertRaises(ValueError): w.eligibility({'agents':rows})

    def test_cli_cannot_inject_commands(self):
        with self.assertRaises(ValueError): w.set_paused('agent-1 shell bad',False)

    def test_member_parser_distinguishes_paused_and_registered(self):
        output = 'plw-inbound has 0 calls\n agent-1 (PJSIP/agent-1) (ringinuse disabled) (Not in use)\n PJSIP/agent-2 (paused was 2 secs ago) (Unavailable)'
        with patch.object(w,'cli',return_value=output):
            self.assertEqual(w.members(),{'agent-1':False,'agent-2':True})

    def test_spool_survives_partial_line_rotation_and_retry(self):
        import csv, io
        stream=io.StringIO(); csv.writer(stream).writerow(self.row()); line=stream.getvalue().encode()
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'plw.csv'
            db=sqlite3.connect(':memory:')
            db.executescript('CREATE TABLE outbox(id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE cursors(identity TEXT PRIMARY KEY,offset INTEGER);')
            with patch.object(w,'CDR',path):
                path.write_bytes(line[:-1]); w.collect(db)
                self.assertEqual(db.execute('SELECT count(*) FROM outbox').fetchone()[0],0)
                path.write_bytes(line); w.collect(db); w.collect(db)
                self.assertEqual(db.execute('SELECT count(*) FROM outbox').fetchone()[0],1)
                with patch.object(w,'request',side_effect=OSError):
                    with self.assertRaises(OSError): w.upload(db)
                self.assertEqual(db.execute('SELECT count(*) FROM outbox').fetchone()[0],1)
                path.rename(path.with_suffix('.csv.1')); path.write_bytes(b''); w.collect(db)
                with patch.object(w,'request',return_value={'accepted':1}): w.upload(db)
                w.collect(db)
                self.assertEqual(db.execute('SELECT count(*) FROM outbox').fetchone()[0],0)


if __name__=='__main__': unittest.main()
