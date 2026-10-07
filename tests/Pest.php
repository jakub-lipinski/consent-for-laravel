<?php

use ConsentForLaravel\ConsentForLaravel\Tests\TestCase;

// config:cache boots a fresh application through Testbench's bootstrap file.
define('TESTBENCH_WORKING_PATH', dirname(__DIR__));

uses(TestCase::class)->in('Feature');
