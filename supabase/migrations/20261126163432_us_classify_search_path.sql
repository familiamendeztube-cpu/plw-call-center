/*
# Campaña EE. UU. — fijar search_path en funciones de clasificación

1. Resumen
   Corrige el hallazgo del linter `function_search_path_mutable` para `us_normalize_phone`
   y `classify_us_phone`: les fija `SET search_path TO ''` (solo usan funciones nativas de
   pg_catalog, que siguen visibles con search_path vacío). Sin cambios de permisos ni de
   datos.
*/
CREATE OR REPLACE FUNCTION public.us_normalize_phone(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g');
  v_national text;
BEGIN
  IF char_length(v_digits) = 11 AND left(v_digits, 1) = '1' THEN
    v_national := right(v_digits, 10);
  ELSIF char_length(v_digits) = 10 THEN
    v_national := v_digits;
  ELSE
    RETURN NULL;
  END IF;
  IF left(v_national, 1) = '0' OR left(v_national, 1) = '1' THEN RETURN NULL; END IF;
  IF substring(v_national, 4, 1) IN ('0', '1') THEN RETURN NULL; END IF;
  RETURN '+1' || v_national;
END $$;

CREATE OR REPLACE FUNCTION public.classify_us_phone(p_e164 text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  v_area int;
BEGIN
  IF p_e164 IS NULL THEN RETURN 'invalid'; END IF;
  IF left(p_e164, 4) = '+506' THEN RETURN 'cr'; END IF;
  IF left(p_e164, 2) <> '+1' OR char_length(p_e164) <> 12 THEN RETURN 'other'; END IF;
  v_area := substring(p_e164, 3, 3)::int;
  IF v_area IN (787, 939, 809, 829, 849, 242, 246, 264, 268, 284, 340, 345, 473, 649, 664,
                670, 671, 684, 721, 758, 767, 784, 868, 869, 876, 658) THEN
    RETURN 'other';
  END IF;
  IF v_area IN (204, 226, 236, 249, 250, 263, 289, 306, 343, 354, 365, 367, 368, 403, 416,
                418, 428, 431, 437, 438, 450, 468, 474, 506, 514, 519, 548, 579, 581, 584,
                587, 604, 613, 639, 647, 683, 705, 709, 742, 753, 778, 780, 782, 807, 819,
                825, 867, 873, 879, 902, 905) THEN
    RETURN 'ca';
  END IF;
  RETURN 'us';
END $$;
