import React from 'react';
import { styled } from '@mui/material/styles';

interface Props {
  temperature: number;
  humidity: number;
}

const WeatherWidget = ({ temperature, humidity }: Props) => {
  return (
    <div>
      <h2>Weather Widget</h2>
      <p>Temperature: {temperature}°C</p>
      <p>Humidity: {humidity}%</p>
    </div>
  );
};

export default WeatherWidget;
