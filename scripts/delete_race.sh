python3 -c "
import sqlite3
con = sqlite3.connect('leaderboard.sqlite3')
cur = con.cursor()
k = 'NASTYNATE1 & CMDR ALEC TURNER-NRCBoontaEveSLFClassis1'
for tbl in ['results','results_history','position_snapshots','constraints']:
    cur.execute(f'DELETE FROM {tbl} WHERE location=?', (k,))
    print(tbl, 'deleted', cur.rowcount)
cur.execute('DELETE FROM last_updated_cache WHERE key=?', (k,))
print('last_updated_cache deleted', cur.rowcount)
cur.execute('DELETE FROM locations WHERE key=?', (k,))
print('locations deleted', cur.rowcount)
con.commit()
for tbl, col in [('results','location'),('results_history','location'),('position_snapshots','location'),('locations','key')]:
    n = cur.execute(f'SELECT COUNT(*) FROM {tbl} WHERE {col}=?', (k,)).fetchone()[0]
    print('remaining', tbl, n)
con.close()
"
