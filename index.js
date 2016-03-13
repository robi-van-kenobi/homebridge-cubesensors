'use strict';
var Service, Characteristic;

// CUSTOM SERVICE AND CHARACTERISTIC IDS
var ATMOSPHERIC_PRESSURE_STYPE_ID = "B77831FD-D66A-46A4-B66D-FD7EE8DFE3CE";
var ATMOSPHERIC_PRESSURE_CTYPE_ID = "28FDA6BC-9C2A-4DEA-AAFD-B49DB6D155AB";

var NOISE_LEVEL_STYPE_ID = "8C85FD40-EB20-45EE-86C5-BCADC773E580";
var NOISE_LEVEL_CTYPE_ID = "2CD7B6FD-419A-4740-8995-E3BFE43735AB";

var THERM_HG_CTYPE_ID   = "3674CD3A-16AF-4C9D-8492-E466B753A697";
var THERM_AWAY_CTYPE_ID = "D5806A47-948D-4707-B350-EF4637B93539";
var THERMOSTAT_STYPE_ID = "43EB2466-3B98-457E-9EE9-BD6E735E6CBF";

module.exports = function (homebridge) {

  Service        = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  Characteristic.AtmosphericPressureLevel = function () {
    Characteristic.call(this, 'barometric pressure', ATMOSPHERIC_PRESSURE_CTYPE_ID);
    this.setProps({
      format:   Characteristic.Formats.UINT8,
      unit:     "mbar",
      minValue: 800,
      maxValue: 1200,
      minStep:  1,
      perms:    [
        Characteristic.Perms.READ,
        Characteristic.Perms.NOTIFY
      ]
    });
    this.value = this.getDefaultValue();
  };
  inherits(Characteristic.AtmosphericPressureLevel, Characteristic);

  Characteristic.NoiseLevel = function () {
    Characteristic.call(this, 'noise level', NOISE_LEVEL_CTYPE_ID);
    this.setProps({
      format:   Characteristic.Formats.UINT8,
      unit:     "dB",
      minValue: 0,
      maxValue: 200,
      minStep:  1,
      perms:    [
        Characteristic.Perms.READ,
        Characteristic.Perms.NOTIFY
      ]
    });
    this.value = this.getDefaultValue();
  };
  inherits(Characteristic.NoiseLevel, Characteristic);

  /**
   *
   * @param displayName
   * @param subtype
   * @constructor
   */
  Service.AtmosphericPressureSensor = function (displayName, subtype) {
    Service.call(this, displayName, ATMOSPHERIC_PRESSURE_STYPE_ID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.AtmosphericPressureLevel);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
    this.addOptionalCharacteristic(Characteristic.Name);
  };
  inherits(Service.AtmosphericPressureSensor, Service);

  /**
   *
   * @param displayName
   * @param subtype
   * @constructor
   */
  Service.NoiseLevelSensor = function (displayName, subtype) {
    Service.call(this, displayName, NOISE_LEVEL_STYPE_ID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.NoiseLevel);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
    this.addOptionalCharacteristic(Characteristic.Name);
  };
  inherits(Service.NoiseLevelSensor, Service);

  homebridge.registerPlatform("homebridge-cubesensors", "cubesensors", CubeSensorsPlatform);
};

var DEFAULT_CACHE_TTL = 30; // 30 seconds caching - use config["ttl"] to override

var cubeSensorsAPI = require("cubesensors-cloud");
var NodeCache      = require("node-cache");
var inherits       = require('util').inherits;
var Q              = require("q");
var _              = require("lodash");
/**
 *
 * @param log
 * @param api
 * @param ttl
 * @constructor
 */
function CubeSenorsRepository(log, api, ttl) {
  this.api   = api;
  this.log   = log;
  this.cache = new NodeCache({stdTTL: ttl});
}

CubeSenorsRepository.prototype = {
  refresh: function (callback) {
    var datasource = {
      modules: {}
    };
    var that       = this;
    that.log.debug("Refresh Cubesensors data from API");

    function getDevices() {
      var deferred = Q.defer();
      that.api.getDevices(function (err, devices) {
        if (err) {
          that.log(err);
          deferred.reject(err);
        }
        deferred.resolve(devices);
      });

      return deferred.promise;
    }

    function getDeviceInfos(device) {
      var deferred = Q.defer();
      that.api.getDeviceInfo(device.uid, function (err, info) {
        if (err) {
          that.log(err);
          deferred.reject(err);
        }
        that.log.debug("refreshing device info " + device.uid + " (" + device.name + ")");
        deferred.resolve(info);
      });
      return deferred.promise;
    }

    function getDeviceState(device) {
      var deferred = Q.defer();
      that.api.getDeviceState(device.uid, function (err, info) {
        if (err) {
          that.log(err);
          deferred.reject(err);
        }
        that.log.debug("refreshing device state " + device.uid + " (" + device.name + ")");
        deferred.resolve(info);
      });
      return deferred.promise;
    }

    getDevices().then(function (devices) {
      var deferred = Q.defer();

      var with_properties = devices.map(function (device) {
        return Q.all([
          getDeviceInfos(device),
          getDeviceState(device)
        ]);
      });

      Q.all(with_properties).done(function (a) {
        deferred.resolve(a);
      });
      return deferred.promise;
    }).then(function (deviceList) {
      var deferred = Q.defer();

      // tranform to array
      deferred.resolve(_.map(deviceList, function (deviceAr) {
        var device  = deviceAr[0];
        device.data = deviceAr[1];
        return device;
      }));

      return deferred.promise;
    }).then(function (deviceList) {
      _.forEach(deviceList, function (device) {
        datasource.modules[device.uid] = device;
      });
      that.cache.set("datasource", datasource);
      callback(datasource);
    });
  },
  load:    function (callback) {
    var that = this;
    this.cache.get("datasource", function (err, datasource) {
      if (err) {
        that.log(err);
      }
      if (!err) {
        if (datasource == undefined) {
          that.refresh(callback);
        } else {
          callback(datasource)
        }
      }
    });
  }
};

/**
 *
 * @param log
 * @param config
 * @constructor
 */
function CubeSensorsPlatform(log, config) {
  var that        = this;
  this.log        = log;
  this.log(config['name']);
  var api         = new cubeSensorsAPI.CubeSensorsAPI(config["auth"]);
  var ttl         = typeof config["ttl"] !== 'undefined' ? config["ttl"] : DEFAULT_CACHE_TTL;
  this.repository = new CubeSenorsRepository(this.log, api, ttl);
  api.on("error", function (error) {
    that.log('ERROR - CubeSensorsCloud: ' + error);
  });
  api.on("warning", function (error) {
    that.log('WARN - CubeSensorsCloud: ' + error);
  });
}

CubeSensorsPlatform.prototype = {
  accessories: function (callback) {

    var that             = this;
    var foundAccessories = [];

    this.repository.load(function (datasource) {
      for (var uid in datasource.modules) {
        var device    = datasource.modules[uid];
        var accessory = new CubeSensorsAccessory(that.log, that.repository, device);
        foundAccessories.push(accessory);
      }
      callback(foundAccessories);
    });

  }
};

/**
 *
 * @param log
 * @param repository
 * @param device
 * @constructor
 */
function CubeSensorsAccessory(log, repository, device) {
  this.log        = log;
  this.repository = repository;
  this.deviceId   = device.uid;
  this.name       = device.name;
  this.serial     = device.mark;
  this.firmware   = "n/a";
  this.model      = device.type;
  this.extra      = device.extra;
  this.type       = device.type;
}

CubeSensorsAccessory.prototype = {

  getData: function (callback) {
    var that = this;
    this.repository.load(function (datasource) {
      callback(datasource.modules[that.deviceId]);
    });
  },

  identify: function (callback) {
    this.log("Identify requested!");
    callback(); // success
  },

  currentTemperature: function (callback) {
    this.getData(function (deviceData) {
      if (deviceData.data != undefined) {
        if (deviceData.data.temperature != undefined) {
          callback(null, deviceData.data.temperature);
        } else {
          callback(null, null);
        }
      } else {
        callback(null, null);
      }
    }.bind(this));
  },

  currentRelativeHumidity: function (callback) {
    this.getData(function (deviceData) {
      if (deviceData.data != undefined) {
        if (deviceData.data.humidity != undefined) {
          callback(null, deviceData.data.humidity);
        } else {
          callback(null, null);
        }
      } else {
        callback(null, null);
      }
    }.bind(this));
  },

  carbonDioxideDetected: function (callback) {
    this.getData(function (deviceData) {
      var result = (deviceData.data.voc > 1000 ? Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL : Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL);
      callback(null, result);
    }.bind(this));
  },

  carbonDioxideLevel: function (callback) {
    this.getData(function (deviceData) {
      callback(null, deviceData.data.voc);
    }.bind(this));
  },

  airQuality: function (callback) {
    this.getData(function (deviceData) {
      var level   = deviceData.data.voc;
      var quality = Characteristic.AirQuality.UNKNOWN;
      if (level > 2000) {
        quality = Characteristic.AirQuality.POOR;
      } else if (level > 1500) {
        quality = Characteristic.AirQuality.INFERIOR;
      } else if (level > 1000) {
        quality = Characteristic.AirQuality.FAIR;
      } else if (level > 500) {
        quality = Characteristic.AirQuality.GOOD;
      } else if (level > 250) {
        quality = Characteristic.AirQuality.EXCELLENT;
      }
      callback(null, quality);
    }.bind(this));
  },

  batteryLevel: function (callback) {
    this.getData(function (deviceData) {
      callback(null, deviceData.last_state.battery_percentage);
    }.bind(this));
  },

  statusLowBattery: function (callback) {
    this.getData(function (deviceData) {
      var charge = deviceData.last_state.battery;
      var level  = charge < 1200 ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
      callback(null, level);
    }.bind(this));
  },

  atmosphericPressure: function (callback) {
    this.getData(function (deviceData) {
      callback(null, deviceData.data.pressure);
    }.bind(this));
  },

  noiseLevel: function (callback) {
    this.getData(function (deviceData) {
      callback(null, deviceData.data.noisedba);
    }.bind(this));
  },

  getServices: function () {
    var that     = this;
    var services = [];

    that.log.debug("creating services for " + this.serial + " (" + this.name + ")");

    // INFORMATION ///////////////////////////////////////////////////
    var informationService     = new Service.AccessoryInformation();
    var firmwareCharacteristic = informationService.getCharacteristic(Characteristic.FirmwareRevision)
      || informationService.addCharacteristic(Characteristic.FirmwareRevision);
    services.push(informationService);

    informationService
      .setCharacteristic(Characteristic.Manufacturer, "CubeSensors")
      .setCharacteristic(Characteristic.Model, this.type)
      .setCharacteristic(Characteristic.Name, this.name)
      .setCharacteristic(Characteristic.SerialNumber, this.deviceId)
      .setCharacteristic(Characteristic.FirmwareRevision, this.firmware);

    if (this.model == "cube") {

      // TEMPERATURE //////////////////////////////////////////////////
      var temperatureSensor = new Service.TemperatureSensor(this.name + " Temperature");
      services.push(temperatureSensor);

      var tmpChar = temperatureSensor.getCharacteristic(Characteristic.CurrentTemperature);
      tmpChar.setProps({minValue: -100});
      tmpChar.on('get', this.currentTemperature.bind(this));

      // HUMIDITY ////////////////////////////////////////////////////
      var humiditySensor = new Service.HumiditySensor(this.name + " Humidity");
      services.push(humiditySensor);
      humiditySensor.getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .on('get', this.currentRelativeHumidity.bind(this));

      // CO2 SENSOR /////////////////////////////////////////////////
      var carbonDioxideSensor              = new Service.CarbonDioxideSensor(this.name + " Carbon Dioxide");
      var carbonDioxideLevelCharacteristic = carbonDioxideSensor.getCharacteristic(Characteristic.CarbonDioxideLevel)
        || carbonDioxideSensor.addCharacteristic(Characteristic.CarbonDioxideLevel);

      services.push(carbonDioxideSensor);
      carbonDioxideSensor.getCharacteristic(Characteristic.CarbonDioxideDetected)
        .on('get', this.carbonDioxideDetected.bind(this));
      carbonDioxideLevelCharacteristic
        .on('get', this.carbonDioxideLevel.bind(this));

      var airQualitySensor = new Service.AirQualitySensor(this.name + " Air Quality");
      services.push(airQualitySensor);
      airQualitySensor.getCharacteristic(Characteristic.AirQuality)
        .on('get', this.airQuality.bind(this));

      // ATMOSPHERIC PRESSURE /////////////////////////////////////////////////////
      var atmosphericPressureSensor = new Service.AtmosphericPressureSensor(this.name + " Atmospheric Pressure");
      services.push(atmosphericPressureSensor);
      atmosphericPressureSensor.getCharacteristic(Characteristic.AtmosphericPressureLevel)
        .on('get', this.atmosphericPressure.bind(this));

      // NOISE LEVEL //////////////////////////////////////////////////////////////
      var noiseLevelSensor = new Service.NoiseLevelSensor(this.name + " Noise Level");
      services.push(noiseLevelSensor);
      noiseLevelSensor.getCharacteristic(Characteristic.NoiseLevel)
        .on('get', this.noiseLevel.bind(this));
    }

    // BATTERY SERVICE ////////////////////////////////////////////
    if (this.extra.last_state.battery) {
      var batteryService = new Service.BatteryService(this.name + " Battery Level");
      services.push(batteryService);
      batteryService.getCharacteristic(Characteristic.BatteryLevel)
        .on('get', this.batteryLevel.bind(this));
      batteryService.getCharacteristic(Characteristic.StatusLowBattery)
        .on('get', this.statusLowBattery.bind(this));
    }

    // TODO: Check Elgato Eve Characteristics (map min, max, time series, etc.)!
    return services;
  }
};
