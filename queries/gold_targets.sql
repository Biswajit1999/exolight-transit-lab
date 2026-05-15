SELECT TOP 150
    pl_name, hostname, ra, dec, pl_orbper, pl_trandep, pl_trandur, pl_ratror, pl_ratdor,
    pl_orbincl, pl_orbeccen, pl_orblper, st_teff, st_rad, st_mass, st_lum, sy_vmag
FROM pscomppars
WHERE
    tran_flag = 1 AND
    pl_ratror IS NOT NULL AND
    pl_ratdor IS NOT NULL AND
    pl_orbper IS NOT NULL AND
    pl_orbincl IS NOT NULL AND
    st_rad IS NOT NULL AND
    sy_vmag IS NOT NULL AND
    sy_vmag < 12
ORDER BY pl_trandep DESC
