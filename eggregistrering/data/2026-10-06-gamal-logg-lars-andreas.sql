-- Registreringar flytta frå den gamle Hønseri-appen (Excel-logg frå telefonen til
-- Lars Andreas, 06.10.2026): 50 dagar frå 29.06.2026 til 05.10.2026.
--
-- Blir køyrd av `npm run deploy` etter migreringane. Fila kan køyrast fleire gonger:
--  * kvar rad har fast ID (gamal-la-ÅÅÅÅ-MM-DD), og ein ID som finst blir hoppa over
--  * ein dag som Lars Andreas allereie har registrert i den nye appen, blir ikkje lagt inn på nytt
-- Revisjonsloggen viser «flytta frå gamal app» som kven og kva.
-- NB: «For på silo» 30.06–02.07 står truleg i tonn (4,06 / 2,2 / 12,68) og er
-- teke over slik dei stod i den gamle appen. Rett dei i appen om ønskjeleg.

UPDATE ctx SET user = 'flytta frå gamal app', action = 'flytta', reason = 'Excel-logg frå Lars Andreas 06.10.2026' WHERE id = 1;

INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-06-29', 'Lars Andreas', '2026-06-29', 15570, 9, 2, 0, 0, 0, 0, 5700, 195.9, 0, 0, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-06-29' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-06-30', 'Lars Andreas', '2026-06-30', 15570, 8, 2, 0, 0, 0, 0, 4.06, 194.8, 2, 0, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-06-30' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-01', 'Lars Andreas', '2026-07-01', 15600, 9, 2, 0, 0, 0, 0, 2.2, 196.5, 1, 0, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-01' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-02', 'Lars Andreas', '2026-07-02', 15450, 9, 2, 0, 0, 0, 0, 12.68, 198.4, 0, 0, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-02' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-07', 'Lars Andreas', '2026-07-07', 15690, 5, 2, 6, 0, 0, 0, 3560, 206, 1, 4, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-07' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-08', 'Lars Andreas', '2026-07-08', 15870, 5, 2, 0, 0, 0, 0, 14820, 205.3, 0, 4.2, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-08' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-09', 'Lars Andreas', '2026-07-09', 15690, 7, 71, 0, 4, 0, 0, 13000, 206.8, 1, 4.1, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-09' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-10', 'Lars Andreas', '2026-07-10', 15660, 6, 28, 0, 1, 0, 0, 11160, 203.8, 0, 3.4, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-10' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-13', 'Lars Andreas', '2026-07-13', 15840, 6, 24, 0, 0, 0, 0, 5580, 203.5, 0, 3.4, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-13' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-14', 'Lars Andreas', '2026-07-14', 15840, 5, 57, 0, 0, 0, 0, 3740, 199.3, 2, 4, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-14' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-15', 'Lars Andreas', '2026-07-15', 15840, 5, 85, 0, 10, 0, 0, 1620, 199.2, 1, 4.3, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-15' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-16', 'Lars Andreas', '2026-07-16', 15840, 6, 33, 0, 3, 0, 0, 13020, 200.4, 2, 3.5, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-16' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-17', 'Lars Andreas', '2026-07-17', 15780, 5, 66, 0, 7, 0, 0, 11200, 200, 0, 4, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-17' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-20', 'Lars Andreas', '2026-07-20', 15630, 4, 80, 0, 0, 0, 0, 5680, 202.4, 3, 4.2, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-20' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-21', 'Lars Andreas', '2026-07-21', 15930, 5, 66, 3, 1, 0, 0, 3840, 201.6, 0, 4.2, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-21' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-22', 'Lars Andreas', '2026-07-22', 15840, 5, 102, 6, 19, 0, 0, 1740, 199.6, 0, 4.4, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-22' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-23', 'Lars Andreas', '2026-07-23', 15690, 3, 50, 0, 6, 0, 0, 12859, 198.8, 1, 4, '5 brett egg knust i stablaren', 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-23' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-24', 'Lars Andreas', '2026-07-24', 15840, 4, 70, 6, 2, 0, 0, 10760, 200.6, 1, 4.4, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-24' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-27', 'Lars Andreas', '2026-07-27', 15780, 3, 77, 6, 15, 0, 0, 5239, 198.4, 2, 4.5, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-27' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-28', 'Lars Andreas', '2026-07-28', 15780, 4, 46, 0, 14, 0, 0, 3420, 199.5, 4, 4.5, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-28' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-29', 'Lars Andreas', '2026-07-29', 15810, 4, 48, 0, 7, 0, 0, 14680, 200.3, 1, 4.2, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-29' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-30', 'Lars Andreas', '2026-07-30', 15780, 3, 63, 0, 3, 0, 0, 12659, 199.7, 1, 4.2, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-30' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-07-31', 'Lars Andreas', '2026-07-31', 15810, 3, 107, 0, 5, 0, 0, 11060, 199.7, 0, 4.1, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-07-31' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-08-03', 'Lars Andreas', '2026-08-03', 15720, 3, 102, 0, 4, 0, 0, 5639, 199.1, 0, 4.2, '40 brett hareid sjukehein
42 brett ingar u/sjukeheim?', 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-08-03' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-08-04', 'Lars Andreas', '2026-08-04', 15750, 1, 81, 0, 2, 0, 0, 3499, 200.8, 0, 5, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-08-04' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-01', 'Lars Andreas', '2026-09-01', 15720, 1, 92, 0, 5, 0, 0, 3659, 206.8, 3, 4.2, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-01' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-02', 'Lars Andreas', '2026-09-02', 15480, 2, 127, 0, 3, 0, 0, 2099, 206, 0, 4.1, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-02' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-03', 'Lars Andreas', '2026-09-03', 15570, 2, 100, 0, 3, 0, 0, 13020, 207.7, 1, 4.2, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-03' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-04', 'Lars Andreas', '2026-09-04', 15420, 1, 70, 6, 3, 0, 0, 11500, 209.7, 0, 4.1, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-04' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-07', 'Lars Andreas', '2026-09-07', 15660, 1, 102, 3, 4, 0, 0, 5760, 213, 1, 4.2, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-07' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-08', 'Lars Andreas', '2026-09-08', 15630, 1, 78, 0, 4, 0, 0, 4180, 209.7, 3, 4.1, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-08' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-09', 'Lars Andreas', '2026-09-09', 15630, 2, 76, 0, 3, 0, 0, 2360, 212.6, 0, 3.4, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-09' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-10', 'Lars Andreas', '2026-09-10', 15430, 1, 56, 0, 3, 0, 0, 540, 210.1, 0, 4, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-10' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-11', 'Lars Andreas', '2026-09-11', 15510, 1, 90, 0, 4, 0, 0, 12480, 210.6, 10, 4, '30 brett hareid sjukeheim', 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-11' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-14', 'Lars Andreas', '2026-09-14', 15600, 1, 102, 0, 3, 0, 0, 7060, 207.1, 0, 4.1, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-14' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-15', 'Lars Andreas', '2026-09-15', 15570, 1, 76, 0, 4, 0, 0, 5280, 206.4, 2, 4.1, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-15' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-16', 'Lars Andreas', '2026-09-16', 15540, 2, 133, 0, 4, 0, 0, 3520, 201.1, 5, 6.3, '40 Brett Ulstein sjukeheim', 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-16' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-17', 'Lars Andreas', '2026-09-17', 15600, 1, 102, 0, 3, 0, 0, 15760, 203.2, 0, 4.2, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-17' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-18', 'Lars Andreas', '2026-09-18', 15450, 2, 89, 0, 4, 0, 0, 14000, 203.5, 1, 3.5, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-18' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-21', 'Lars Andreas', '2026-09-21', 15570, 2, 93, 0, 4, 0, 0, 8660, 208.7, 0, 4.2, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-21' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-22', 'Lars Andreas', '2026-09-22', 15540, 1, 69, 0, 4, 0, 0, 16800, 208.6, 4, 4.2, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-22' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-23', 'Lars Andreas', '2026-09-23', 15450, 1, 124, 6, 4, 0, 0, 14680, 208.3, 3, 4.4, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-23' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-24', 'Lars Andreas', '2026-09-24', 15450, 1, 102, 0, 4, 0, 0, 12880, 207.7, 3, 4.3, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-24' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-25', 'Lars Andreas', '2026-09-25', 15300, 1, 61, 0, 4, 0, 0, 11400, 209.9, 6, 4.4, '30 Brett hareid sjukeheim', 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-25' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-28', 'Lars Andreas', '2026-09-28', 15360, 0, 106, 0, 4, 0, 0, 5560, 214.6, 2, 4.3, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-28' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-29', 'Lars Andreas', '2026-09-29', 15420, 2, 56, 6, 4, 0, 0, 17040, 213.8, 1, 4.1, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-29' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-09-30', 'Lars Andreas', '2026-09-30', 15300, 0, 51, 0, 3, 0, 0, 15280, 210.1, 3, 4.1, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-09-30' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-10-01', 'Lars Andreas', '2026-10-01', 15450, 1, 94, 0, 6, 0, 0, 13180, 211.7, 5, 4.4, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-10-01' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-10-02', 'Lars Andreas', '2026-10-02', 15390, 1, 86, 6, 4, 0, 0, 11400, 209.1, 2, 5, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-10-02' AND navn = 'Lars Andreas' AND deleted = 0);
INSERT OR IGNORE INTO entries (uid, navn, dato, egg, store, vanlige, kartonger, klink, pall200, pall228, silo, vann, dode, timer, kommentar, created_by)
  SELECT 'gamal-la-2026-10-05', 'Lars Andreas', '2026-10-05', 15360, 1, 111, 0, 4, 0, 0, 6040, 212.6, 6, 5, NULL, 'flytta frå gamal app'
  WHERE NOT EXISTS (SELECT 1 FROM entries WHERE dato = '2026-10-05' AND navn = 'Lars Andreas' AND deleted = 0);

UPDATE ctx SET user = NULL, action = NULL, reason = NULL WHERE id = 1;
