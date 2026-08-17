# R1-P Preview evidence manifest

- status: **FAIL**
- cases: 29 (28 controlled + 1 unmocked smoke)
- console errors: 0, page errors: 0
- backdoor scan: 19 source hits over 1015 files, bundle scanned=True, bundle hits=20

| case | viewport | theme | png | dom | json | console | pageErr | copy lines |
|---|---|---|---|---|---|---|---|---|
| ready__desktop__light | 1280x900 | light | 69742 | 267186 | 330 | 0 | 0 | None |
| ready__desktop__dark | 1280x900 | dark | 70126 | 267407 | 328 | 0 | 0 | None |
| ready__mobile__light | 390x844 | light | 54802 | 260766 | 328 | 0 | 0 | None |
| ready__mobile__dark | 390x844 | dark | 55427 | 260988 | 326 | 0 | 0 | None |
| manual_review_6515__desktop__light | 1280x900 | light | 64096 | 254690 | 356 | 0 | 0 | True |
| manual_review_6515__desktop__dark | 1280x900 | dark | 64537 | 254912 | 354 | 0 | 0 | True |
| manual_review_6515__mobile__light | 390x844 | light | 54037 | 254690 | 354 | 0 | 0 | True |
| manual_review_6515__mobile__dark | 390x844 | dark | 54622 | 254912 | 352 | 0 | 0 | True |
| incomplete_fx__desktop__light | 1280x900 | light | 64096 | 254690 | 346 | 0 | 0 | True |
| incomplete_fx__desktop__dark | 1280x900 | dark | 64537 | 254912 | 344 | 0 | 0 | True |
| incomplete_fx__mobile__light | 390x844 | light | 54037 | 254690 | 344 | 0 | 0 | True |
| incomplete_fx__mobile__dark | 390x844 | dark | 55186 | 254912 | 2761 | 0 | 0 | True |
| incomplete_warrant__desktop__light | 1280x900 | light | 64096 | 254690 | 356 | 0 | 0 | True |
| incomplete_warrant__desktop__dark | 1280x900 | dark | 65348 | 254912 | 2773 | 0 | 0 | True |
| incomplete_warrant__mobile__light | 390x844 | light | 54029 | 254690 | 354 | 0 | 0 | True |
| incomplete_warrant__mobile__dark | 390x844 | dark | 54622 | 254912 | 352 | 0 | 0 | True |
| incomplete_option_combo__desktop__light | 1280x900 | light | 64096 | 254690 | 366 | 0 | 0 | True |
| incomplete_option_combo__desktop__dark | 1280x900 | dark | 64537 | 254912 | 364 | 0 | 0 | True |
| incomplete_option_combo__mobile__light | 390x844 | light | 54037 | 254690 | 364 | 0 | 0 | True |
| incomplete_option_combo__mobile__dark | 390x844 | dark | 54622 | 254912 | 362 | 0 | 0 | True |
| no_projection__desktop__light | 1280x900 | light | 69741 | 267185 | 618 | 0 | 0 | False |
| no_projection__desktop__dark | 1280x900 | dark | 70125 | 267408 | 616 | 0 | 0 | False |
| no_projection__mobile__light | 390x844 | light | 54798 | 260766 | 616 | 0 | 0 | False |
| no_projection__mobile__dark | 390x844 | dark | 55427 | 260988 | 614 | 0 | 0 | False |
| api_error__desktop__light | 1280x900 | light | 64096 | 254690 | 622 | 0 | 0 | True |
| api_error__desktop__dark | 1280x900 | dark | 64499 | 254912 | 845 | 0 | 0 | True |
| api_error__mobile__light | 390x844 | light | 54037 | 254690 | 620 | 0 | 0 | True |
| api_error__mobile__dark | 390x844 | dark | 54653 | 254912 | 618 | 0 | 0 | True |
| smoke-home | 1280x900 | light | 78178 | 317159 | 415 | 0 | 0 | None |

## Failures

- manual_review_6515__desktop__light: forbidden economics rendered ['+10']
- manual_review_6515__desktop__dark: forbidden economics rendered ['+10']
- manual_review_6515__mobile__light: forbidden economics rendered ['+10']
- manual_review_6515__mobile__dark: forbidden economics rendered ['+10']
- incomplete_fx__desktop__light: forbidden economics rendered ['+10']
- incomplete_fx__desktop__dark: forbidden economics rendered ['+10']
- incomplete_fx__mobile__light: forbidden economics rendered ['+10']
- incomplete_fx__mobile__dark: forbidden economics rendered ['+10']
- incomplete_warrant__desktop__light: forbidden economics rendered ['+10']
- incomplete_warrant__desktop__dark: forbidden economics rendered ['+10']
- incomplete_warrant__mobile__light: forbidden economics rendered ['+10']
- incomplete_warrant__mobile__dark: forbidden economics rendered ['+10']
- incomplete_option_combo__desktop__light: forbidden economics rendered ['+10']
- incomplete_option_combo__desktop__dark: forbidden economics rendered ['+10']
- incomplete_option_combo__mobile__light: forbidden economics rendered ['+10']
- incomplete_option_combo__mobile__dark: forbidden economics rendered ['+10']
- no_projection__desktop__light: incomplete case is missing the two copy lines
- no_projection__desktop__light: forbidden economics rendered ['+10']
- no_projection__desktop__dark: incomplete case is missing the two copy lines
- no_projection__desktop__dark: forbidden economics rendered ['+10']
- no_projection__mobile__light: incomplete case is missing the two copy lines
- no_projection__mobile__light: forbidden economics rendered ['+10']
- no_projection__mobile__dark: incomplete case is missing the two copy lines
- no_projection__mobile__dark: forbidden economics rendered ['+10']
- api_error__desktop__light: forbidden economics rendered ['+10']
- api_error__desktop__dark: forbidden economics rendered ['+10']
- api_error__mobile__light: forbidden economics rendered ['+10']
- api_error__mobile__dark: forbidden economics rendered ['+10']
- backdoor scan found 19 hits
- production bundle scan found 20 hits
