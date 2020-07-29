﻿using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Newtonsoft.Json;

namespace VsCodeXamarinUtil
{
	public class DeviceData
	{
		[JsonProperty("name")]
		public string Name { get; set; }

		[JsonProperty("serial")]
		public string Serial { get; set; }

		[JsonProperty("platform")]
		public string Platform { get; set; }

		[JsonProperty("version")]
		public string Version { get; set; }

		[JsonProperty("isEmulator")]
		public bool IsEmulator { get; set; }

		[JsonProperty("isRunning")]
		public bool IsRunning { get; set; }
	}

	public class SimpleResult
	{
		[JsonProperty("success")]
		public bool Success { get; set; }
	}
	public enum ProjectType {
		Mono,
		Android,
		iOS,
		Mac,
		UWP,
		Unknown,
		WPF,
		Blazor,

	}
	public class LaunchData {
		public string AppName { get; set; } = "";
		public string Project { get; set; }
		public string Configuration { get; set; }
		public string Platform { get; set; }
		public ProjectType ProjectType { get; set; }
		public string OutputDirectory { get; set; }
		public bool EnableHotReload { get; set; }
		public string iOSDeviceId { get; set; }
		public string iOSSimulatorVersion { get; set; }
		public string iOSSimulatorDevice { get; set; }
		public string iOSSimulatorDeviceType { get; set; }
		public string AdbDeviceName { get; set; }
		public string AdbDeviceId { get; set; }


		public LaunchData ()
		{

		}
		public LaunchData(dynamic args)
		{
			Project = getString (args, VSCodeKeys.LaunchConfig.ProjectPath);
			Configuration = getString (args, VSCodeKeys.LaunchConfig.Configuration);
			Platform = getString (args, VSCodeKeys.LaunchConfig.Platform, "AnyCPU");
			OutputDirectory = cleanseStringPaths(getString (args, VSCodeKeys.LaunchConfig.Output));
			EnableHotReload = getBool (args, nameof (EnableHotReload));
			iOSDeviceId = getString (args, VSCodeKeys.LaunchConfig.iosDeviceId);
			iOSSimulatorDevice = getString (args, VSCodeKeys.LaunchConfig.iOSSimulatorDeviceRuntime);
			iOSSimulatorVersion = getString (args, VSCodeKeys.LaunchConfig.iOSSimulatorVersion);
			iOSSimulatorDeviceType = getString (args, VSCodeKeys.LaunchConfig.iOSSimulatorDeviceType);
			AdbDeviceName = getString (args, VSCodeKeys.LaunchConfig.AdbEmulatorName);
			AdbDeviceId = getString (args, VSCodeKeys.LaunchConfig.AdbDeviceId);
			var projectTypeString = getInt (args, VSCodeKeys.LaunchConfig.ProjectType,0);
			ProjectType = (ProjectType)projectTypeString;
			//if(string.IsNullOrWhiteSpace(projectTypeString))
			//	ProjectType = Enum.Parse (typeof(ProjectType), projectTypeString,true);
		}

		public (bool success, string message) Validate ()
		{
			(bool success, string message) validateString (string value, string name)
				=> string.IsNullOrWhiteSpace(value) ? (false, $"{name} is not valid") : (true, "");
			var checks = new[] {
				validateString(Project,nameof(Project)),
				validateString(Configuration,nameof(Configuration)),
				validateString(OutputDirectory,nameof(OutputDirectory)),
			};
			foreach(var check in checks) {
				if (!check.success)
					return check;
			}
			
			if(ProjectType == ProjectType.iOS) {
				if ((string.IsNullOrWhiteSpace (iOSSimulatorVersion) || string.IsNullOrWhiteSpace (iOSSimulatorDeviceType))
					&& !string.IsNullOrWhiteSpace(iOSDeviceId))
					return (false, "iOS simulator is not valid");
				if (string.IsNullOrWhiteSpace (iOSDeviceId) && string.IsNullOrWhiteSpace(iOSSimulatorVersion))
					return (false, $"{nameof (iOSDeviceId)} is not valid");
			}
			else if(ProjectType == ProjectType.Android) {
				if (string.IsNullOrWhiteSpace (AdbDeviceId) && string.IsNullOrWhiteSpace (AdbDeviceName))
					return (false, "Android device is not valid");
			}
		
			return (true, "");
		}

		static string cleanseStringPaths(string path)
		{
			if (Util.IsWindows)
				return path;
			return path.Replace ("\\", "/");
		}

		private static bool getBool (dynamic container, string propertyName, bool dflt = false)
		{
			try {
				return (bool)container [propertyName];
			} catch (Exception) {
				// ignore and return default value
			}
			return dflt;
		}

		private static int getInt (dynamic container, string propertyName, int dflt = 0)
		{
			try {
				return (int)container [propertyName];
			} catch (Exception) {
				// ignore and return default value
			}
			return dflt;
		}

		private static string getString (dynamic args, string property, string dflt = null)
		{
			var s = (string)args [property];
			if (s == null) {
				return dflt;
			}
			s = s.Trim ();
			if (s.Length == 0) {
				return dflt;
			}
			return s;
		}

	}
}
