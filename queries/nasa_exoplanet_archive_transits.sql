SELECT TOP 500
  pl_name, hostname, pl_orbper, pl_orbsmax, pl_rade, pl_radj, pl_bmassj,
  pl_orbincl, pl_trandep, pl_trandur, st_rad, st_mass, st_teff, sy_dist, discoverymethod
FROM pscomppars
WHERE tran_flag = 1
  AND pl_orbper IS NOT NULL
  AND st_rad IS NOT NULL
  AND (pl_rade IS NOT NULL OR pl_radj IS NOT NULL)
ORDER BY pl_trandep DESC
